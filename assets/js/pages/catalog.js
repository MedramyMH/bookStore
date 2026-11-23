import { CONFIG } from "../config.js";
import { t, fmtNumber, LANG_NAMES } from "../i18n.js";
import { esc, icon, bookCard, skeletonGrid, emptyState, setTitle, debounce } from "../ui.js";
import { listBooks, getCategories, getOwnedIds } from "../api.js";

export default async function render({ root, query, isCurrent }) {
  setTitle(t("navBooks"));
  const f = {
    q: query.get("q") || "",
    language: query.get("language") || "",
    category: query.get("category") || "",
    price: query.get("price") || "",
    sort: query.get("sort") || "newest",
  };

  root.innerHTML = `
  <div class="container">
    <div class="page-head">
      <h1>${esc(t("allBooks"))}</h1>
      <p class="muted" id="result-count">&nbsp;</p>
    </div>
    <div class="catalog">
      <aside class="filters" id="filters">
        <label class="field">
          <span>${esc(t("search"))}</span>
          <div class="input-icon">${icon("search")}<input class="input" type="search" name="q" value="${esc(f.q)}" placeholder="${esc(t("searchPlaceholder"))}" /></div>
        </label>
        <div class="field">
          <span>${esc(t("language"))}</span>
          <div class="chips" data-filter="language">
            <button class="chip" data-v="">${esc(t("all"))}</button>
            ${["ar", "en", "fr"].map((l) => `<button class="chip" data-v="${l}" lang="${l}">${LANG_NAMES[l]}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <span>${esc(t("price"))}</span>
          <div class="chips" data-filter="price">
            <button class="chip" data-v="">${esc(t("all"))}</button>
            <button class="chip" data-v="free">${esc(t("free"))}</button>
            <button class="chip" data-v="paid">${esc(t("paid"))}</button>
          </div>
        </div>
        <label class="field">
          <span>${esc(t("category"))}</span>
          <select class="input" name="category"><option value="">${esc(t("allCategories"))}</option></select>
        </label>
        <label class="field">
          <span>${esc(t("sortBy"))}</span>
          <select class="input" name="sort">
            ${["newest", "popular", "rating", "downloads", "price_asc", "price_desc", "title"].map((s) =>
              `<option value="${s}" ${f.sort === s ? "selected" : ""}>${esc(t("sort_" + s))}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-ghost btn-sm" id="reset-filters">${esc(t("resetFilters"))}</button>
      </aside>
      <section>
        <div id="results">${skeletonGrid(12)}</div>
        <div class="load-more-wrap"><button class="btn btn-ghost" id="load-more" hidden>${esc(t("loadMore"))}</button></div>
      </section>
    </div>
  </div>`;

  const results = root.querySelector("#results");
  const moreBtn = root.querySelector("#load-more");
  const countEl = root.querySelector("#result-count");
  let offset = 0, total = 0, owned = new Set();

  const syncChips = () => root.querySelectorAll(".chips").forEach((c) =>
    c.querySelectorAll(".chip").forEach((b) => b.classList.toggle("active", b.dataset.v === f[c.dataset.filter])));
  syncChips();

  const updateUrl = () => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v && !(k === "sort" && v === "newest") && p.set(k, v));
    const qs = p.toString();
    history.replaceState(null, "", `#/books${qs ? "?" + qs : ""}`);
  };

  async function load(reset = true) {
    if (reset) { offset = 0; results.innerHTML = skeletonGrid(12); }
    moreBtn.disabled = true;
    try {
      const { data, count } = await listBooks({ ...f, from: offset, limit: CONFIG.PAGE_SIZE });
      if (!isCurrent()) return;
      total = count ?? 0;
      countEl.textContent = t("booksFound", { n: fmtNumber(total) });
      const html = data.map((b) => bookCard(b, { owned: owned.has(b.id) })).join("");
      if (reset) {
        results.innerHTML = data.length ? `<div class="book-grid">${html}</div>`
          : emptyState(t("noResults"), t("noResultsText"));
      } else {
        results.querySelector(".book-grid").insertAdjacentHTML("beforeend", html);
      }
      offset += data.length;
      moreBtn.hidden = offset >= total;
    } catch (e) {
      results.innerHTML = emptyState(t("errGeneric"), e.message);
    } finally { moreBtn.disabled = false; }
  }

  const refresh = () => { updateUrl(); load(true); };

  root.querySelectorAll(".chips").forEach((c) => c.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    f[c.dataset.filter] = b.dataset.v; syncChips(); refresh();
  }));
  root.querySelector('[name="q"]').addEventListener("input", debounce((e) => { f.q = e.target.value.trim(); refresh(); }, 350));
  root.querySelector('[name="sort"]').onchange = (e) => { f.sort = e.target.value; refresh(); };
  const catSel = root.querySelector('[name="category"]');
  catSel.onchange = (e) => { f.category = e.target.value; refresh(); };
  root.querySelector("#reset-filters").onclick = () => {
    Object.assign(f, { q: "", language: "", category: "", price: "", sort: "newest" });
    root.querySelector('[name="q"]').value = ""; catSel.value = ""; root.querySelector('[name="sort"]').value = "newest";
    syncChips(); refresh();
  };
  moreBtn.onclick = () => load(false);

  [owned] = await Promise.all([getOwnedIds().catch(() => new Set())]);
  getCategories().then((cats) => {
    catSel.insertAdjacentHTML("beforeend", cats.map((c) => `<option ${c === f.category ? "selected" : ""}>${esc(c)}</option>`).join(""));
  }).catch(() => {});
  await load(true);
}
