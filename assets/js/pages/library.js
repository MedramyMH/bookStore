import { t, fmtNumber, fmtDate } from "../i18n.js";
import { state } from "../store.js";
import { esc, icon, bookCard, coverHTML, emptyState, setTitle, skeletonGrid } from "../ui.js";
import { listMyProgress, listMyPurchases, listWishlist } from "../api.js";

export default async function render({ root, query, isCurrent }) {
  setTitle(t("navLibrary"));
  const tab = query.get("tab") || "reading";
  const tabs = [
    ["reading", t("tabReading"), "book"],
    ["purchased", t("tabPurchased"), "cart"],
    ["wishlist", t("tabWishlist"), "heart"],
    ["finished", t("tabFinished"), "check"],
  ];

  root.innerHTML = `
  <div class="container">
    <div class="page-head"><h1>${esc(t("myLibrary"))}</h1></div>
    ${!state.user ? `<div class="notice">${icon("user")} <span>${esc(t("guestLibraryNote"))}</span>
      <a class="btn btn-primary btn-sm" href="#/login?next=%2Flibrary">${esc(t("login"))}</a></div>` : ""}
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label, ic]) => `<a role="tab" href="#/library?tab=${k}" class="tab ${k === tab ? "active" : ""}" aria-selected="${k === tab}">${icon(ic)} ${esc(label)}</a>`).join("")}
    </div>
    <div id="lib-body">${skeletonGrid(6)}</div>
  </div>`;

  const body = root.querySelector("#lib-body");
  try {
    if (tab === "reading" || tab === "finished") {
      const list = (await listMyProgress()).filter((p) => (tab === "finished" ? p.finished : !p.finished));
      if (!isCurrent()) return;
      body.innerHTML = list.length
        ? `<div class="reading-list">${list.map(progressRow).join("")}</div>`
        : emptyState(tab === "finished" ? t("noFinished") : t("noReading"), t("startReadingText"),
            `<a class="btn btn-primary" href="#/books">${esc(t("browseBooks"))}</a>`);
    } else if (tab === "purchased") {
      if (!state.user) { body.innerHTML = emptyState(t("loginToSeePurchases")); return; }
      const list = (await listMyPurchases()).filter((p) => p.book && p.status === "completed");
      if (!isCurrent()) return;
      body.innerHTML = list.length
        ? `<div class="book-grid">${list.map((p) => bookCard(p.book, { owned: true })).join("")}</div>`
        : emptyState(t("noPurchases"), "", `<a class="btn btn-primary" href="#/books?price=paid">${esc(t("browseBooks"))}</a>`);
    } else if (tab === "wishlist") {
      if (!state.user) { body.innerHTML = emptyState(t("loginToSeeWishlist")); return; }
      const list = await listWishlist();
      if (!isCurrent()) return;
      body.innerHTML = list.length
        ? `<div class="book-grid">${list.map((b) => bookCard(b)).join("")}</div>`
        : emptyState(t("wishlistEmpty"), "", `<a class="btn btn-primary" href="#/books">${esc(t("browseBooks"))}</a>`);
    }
  } catch (e) {
    body.innerHTML = emptyState(t("errGeneric"), e.message);
  }
}

function progressRow(p) {
  const b = p.book;
  const pct = Math.round(p.percent || 0);
  return `<a class="reading-row" href="#/read/${encodeURIComponent(b.slug)}">
    ${coverHTML(b, "small")}
    <div class="reading-row-info" dir="auto">
      <strong>${esc(b.title)}</strong>
      <span class="muted small">${esc(b.author || "")}</span>
      <div class="progress-line"><span style="width:${Math.max(2, pct)}%"></span></div>
      <span class="small muted">${esc(t("pageOf", { page: fmtNumber(p.page), total: fmtNumber(p.total_pages || "?") }))} · ${pct}% · ${esc(fmtDate(p.updated_at))}</span>
    </div>
    <span class="btn btn-primary btn-sm">${icon(p.finished ? "book" : "play")} ${esc(p.finished ? t("readAgain") : t("resume"))}</span>
  </a>`;
}
