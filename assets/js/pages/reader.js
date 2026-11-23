// The book reader: paged PDF viewer with progress sync, bookmarks, search, themes and auto-reader
import { t, fmtNumber, fmtDate, isRTL, getLang } from "../i18n.js";
import { state } from "../store.js";
import { esc, icon, toast, setTitle, coverHTML, promptDialog, confirmDialog, debounce, modal } from "../ui.js";
import {
  getBook, hasAccess, getBookFileUrl, getProgress, saveProgress, listBookmarks, addBookmark,
  updateBookmark, removeBookmark, downloadBook, bumpStat,
} from "../api.js";
import { openPdf, pdfjsLib, renderPageToCanvas, getPageText } from "../pdf.js";
import { AutoReader, ttsSupported, getVoices, voicesFor } from "../reader/tts.js";
import { openCheckout } from "../payments/paypal.js";

const SETTINGS_KEY = "reader-settings";
const loadSettings = () => {
  try { return { theme: "light", fit: "page", spread: false, zoom: 1, brightness: 100, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
  catch { return { theme: "light", fit: "page", spread: false, zoom: 1, brightness: 100 }; }
};

export default async function render({ root, params, query, isCurrent }) {
  const book = await getBook(params.slug);
  if (!isCurrent()) return;
  if (!book) { location.hash = "#/books"; return; }
  setTitle(book.title);

  const access = await hasAccess(book).catch(() => false);
  const sampleMode = !access;
  if (!access && !book.sample_url) return renderLocked(root, book);
  if (!isCurrent()) return;

  const bookRTL = book.language === "ar";
  const S = loadSettings();
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
  const cleanups = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); };

  // ------------------------------------------------------------------ layout
  root.innerHTML = `
  <div class="reader" id="reader" data-rtheme="${S.theme}" style="--brightness:${S.brightness}%">
    <header class="reader-top">
      <a class="icon-btn" href="#/book/${encodeURIComponent(book.slug)}" title="${esc(t("back"))}" aria-label="${esc(t("back"))}">${icon(isRTL() ? "chevR" : "chevL")}</a>
      <div class="reader-title" dir="auto"><strong>${esc(book.title)}</strong>
        ${sampleMode ? `<span class="badge badge-warn">${esc(t("sample"))}</span>` : ""}</div>
      <div class="reader-tools">
        <button class="icon-btn" data-panel="toc" title="${esc(t("contents"))}" aria-label="${esc(t("contents"))}">${icon("list")}</button>
        <button class="icon-btn" data-panel="search" title="${esc(t("searchInBook"))}" aria-label="${esc(t("searchInBook"))}">${icon("search")}</button>
        <button class="icon-btn" id="bm-toggle" title="${esc(t("bookmarkPage"))}" aria-label="${esc(t("bookmarkPage"))}">${icon("bookmark")}</button>
        <button class="icon-btn" data-panel="bookmarks" title="${esc(t("bookmarks"))}" aria-label="${esc(t("bookmarks"))}">${icon("grid")}</button>
        <button class="icon-btn" id="tts-btn" title="${esc(t("autoReader"))}" aria-label="${esc(t("autoReader"))}">${icon("volume")}</button>
        <button class="icon-btn" data-panel="settings" title="${esc(t("readerSettings"))}" aria-label="${esc(t("readerSettings"))}">${icon("settings")}</button>
        <button class="icon-btn hide-sm" id="fs-btn" title="${esc(t("fullscreen"))}" aria-label="${esc(t("fullscreen"))}">${icon("expand")}</button>
        ${access && book.allow_download ? `<button class="icon-btn hide-sm" id="dl-btn" title="${esc(t("downloadPdf"))}" aria-label="${esc(t("downloadPdf"))}">${icon("download")}</button>` : ""}
      </div>
    </header>

    <div class="reader-stage" id="stage">
      <div class="pages ${bookRTL ? "rtl-book" : ""}" id="pages"></div>
      <button class="nav-zone zone-left" id="zone-left" aria-label="${esc(bookRTL ? t("nextPage") : t("prevPage"))}">${icon("chevL")}</button>
      <button class="nav-zone zone-right" id="zone-right" aria-label="${esc(bookRTL ? t("prevPage") : t("nextPage"))}">${icon("chevR")}</button>
      <div class="reader-loading" id="loading"><span class="spinner"></span><span id="load-pct">${esc(t("loadingBook"))}</span></div>
    </div>

    <footer class="reader-bottom">
      <button class="icon-btn" id="btn-left" aria-label="${esc(bookRTL ? t("nextPage") : t("prevPage"))}">${icon("chevL")}</button>
      <input type="range" id="slider" min="1" max="1" value="1" dir="${bookRTL ? "rtl" : "ltr"}" aria-label="${esc(t("page"))}" />
      <div class="page-indicator">
        <input type="number" id="page-input" min="1" value="1" aria-label="${esc(t("page"))}" />
        <span>/ <span id="page-total">…</span></span>
        <span class="muted small" id="pct"></span>
      </div>
      <button class="icon-btn" id="btn-right" aria-label="${esc(bookRTL ? t("prevPage") : t("nextPage"))}">${icon("chevR")}</button>
    </footer>

    <aside class="reader-panel" id="panel" aria-hidden="true">
      <div class="panel-head"><h3 id="panel-title"></h3><button class="icon-btn" id="panel-close" aria-label="${esc(t("close"))}">${icon("close")}</button></div>
      <div class="panel-body" id="panel-body"></div>
    </aside>

    <div class="tts-bar" id="tts-bar" hidden>
      <div class="tts-text" id="tts-text" dir="${bookRTL ? "rtl" : "ltr"}" lang="${book.language}"></div>
      <div class="tts-controls">
        <button class="icon-btn" id="tts-prev" aria-label="${esc(t("prevSentence"))}">${icon(bookRTL ? "skipNext" : "skipPrev")}</button>
        <button class="icon-btn tts-main" id="tts-play" aria-label="${esc(t("play"))}">${icon("play")}</button>
        <button class="icon-btn" id="tts-next" aria-label="${esc(t("nextSentence"))}">${icon(bookRTL ? "skipPrev" : "skipNext")}</button>
        <select class="input input-sm" id="tts-rate" aria-label="${esc(t("speed"))}">
          ${[0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((r) => `<option value="${r}">${r}×</option>`).join("")}
        </select>
        <select class="input input-sm tts-voice" id="tts-voice" aria-label="${esc(t("voice"))}"></select>
        <label class="switch small"><input type="checkbox" id="tts-auto" /><span></span> ${esc(t("autoTurn"))}</label>
        <button class="icon-btn" id="tts-close" aria-label="${esc(t("close"))}">${icon("close")}</button>
      </div>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const readerEl = $("#reader"), stage = $("#stage"), pagesEl = $("#pages");
  const slider = $("#slider"), pageInput = $("#page-input");

  // ------------------------------------------------------------------ open PDF
  let pdf;
  try {
    const src = sampleMode ? book.sample_url : await getBookFileUrl(book);
    pdf = await openPdf(src, (p) => { const el = $("#load-pct"); if (el) el.textContent = `${p}%`; });
  } catch (e) {
    console.error(e);
    if (!isCurrent()) return;
    $("#loading").innerHTML = `<p>${esc(t("errOpenBook"))}</p><p class="muted small">${esc(e.message || "")}</p>
      <a class="btn btn-primary" href="#/book/${encodeURIComponent(book.slug)}">${esc(t("back"))}</a>`;
    return;
  }
  if (!isCurrent()) { pdf.destroy(); return; }
  $("#loading").remove();

  const N = pdf.numPages;
  slider.max = N; pageInput.max = N;
  $("#page-total").textContent = fmtNumber(N);
  if (!sampleMode) bumpStat(book.id, "views");

  // ------------------------------------------------------------------ state
  let current = 1;
  let bookmarks = [];
  let searchQuery = "";
  const textCache = new Map();
  const pageCache = new Map(); // page number → PDFPageProxy
  const canvasCache = new Map(); // `${n}@${scale}` → canvas (LRU)
  let renderToken = 0;

  const getPage = async (n) => {
    if (!pageCache.has(n)) pageCache.set(n, pdf.getPage(n));
    return pageCache.get(n);
  };
  const getText = async (n) => {
    if (!textCache.has(n)) textCache.set(n, getPage(n).then(getPageText).catch(() => ""));
    return textCache.get(n);
  };

  const spreadActive = () => S.spread && window.innerWidth >= 900 && N > 1;
  const visiblePages = (p = current) => {
    if (!spreadActive()) return [p];
    if (p === 1) return [1];
    const start = p % 2 === 0 ? p : p - 1;
    return start + 1 <= N ? [start, start + 1] : [start];
  };
  const step = () => (spreadActive() ? (current === 1 ? 1 : 2) : 1);

  // ------------------------------------------------------------------ rendering
  async function renderPages(direction = 0) {
    const token = ++renderToken;
    const nums = visiblePages();
    const pages = await Promise.all(nums.map(getPage));
    if (token !== renderToken) return;

    const pad = parseFloat(getComputedStyle(pagesEl).paddingLeft) || 0;
    const availW = stage.clientWidth - pad * 2;
    const availH = stage.clientHeight - pad * 2;
    const base = pages.map((p) => p.getViewport({ scale: 1 }));
    const totalW = base.reduce((a, v) => a + v.width, 0);
    const maxH = Math.max(...base.map((v) => v.height));
    const fitScale = S.fit === "width" ? availW / totalW : Math.min(availW / totalW, availH / maxH);
    const scale = Math.max(0.2, fitScale * S.zoom);

    const frag = document.createDocumentFragment();
    const textJobs = [];
    for (let i = 0; i < pages.length; i++) {
      const n = nums[i];
      const key = `${n}@${scale.toFixed(3)}`;
      let canvas = canvasCache.get(key);
      if (!canvas) {
        ({ canvas } = await renderPageToCanvas(pages[i], { scale }));
        if (token !== renderToken) return;
        cacheCanvas(key, canvas);
      }
      const wrap = document.createElement("div");
      wrap.className = "pdf-page";
      wrap.dataset.page = n;
      wrap.style.setProperty("--total-scale-factor", scale);
      wrap.style.setProperty("--scale-factor", scale);
      wrap.style.width = canvas.style.width;
      wrap.style.height = canvas.style.height;
      wrap.appendChild(canvas);
      const tl = document.createElement("div");
      tl.className = "textLayer";
      wrap.appendChild(tl);
      frag.appendChild(wrap);
      textJobs.push([pages[i], tl, scale]);
    }
    if (token !== renderToken) return;
    pagesEl.replaceChildren(frag);
    pagesEl.classList.toggle("zoomed", S.zoom > 1 || S.fit === "width");
    if (direction) {
      pagesEl.classList.remove("turn-next", "turn-prev");
      void pagesEl.offsetWidth;
      pagesEl.classList.add(direction > 0 ? "turn-next" : "turn-prev");
    }
    stage.scrollTop = 0;

    // text layers (selection + search highlight)
    for (const [page, tl, sc] of textJobs) {
      try {
        const layer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale: sc }) });
        await layer.render();
        if (searchQuery) highlight(tl, searchQuery);
      } catch {}
    }
    // pre-render next pages for instant turning
    prefetch(scale);
  }

  function cacheCanvas(key, canvas) {
    canvasCache.set(key, canvas);
    while (canvasCache.size > 8) canvasCache.delete(canvasCache.keys().next().value);
  }

  const prefetch = debounce(async (scale) => {
    const nextNums = visiblePages(Math.min(N, Math.max(...visiblePages()) + 1)).filter((n) => n <= N);
    for (const n of nextNums) {
      const key = `${n}@${scale.toFixed(3)}`;
      if (canvasCache.has(key)) continue;
      try { const { canvas } = await renderPageToCanvas(await getPage(n), { scale }); cacheCanvas(key, canvas); } catch {}
    }
  }, 250);

  function highlight(tl, q) {
    const needle = q.toLowerCase();
    tl.querySelectorAll("span").forEach((s) => {
      if (s.textContent.toLowerCase().includes(needle)) s.classList.add("hl");
    });
  }

  // ------------------------------------------------------------------ navigation
  function updateUI() {
    const vis = visiblePages();
    const last = vis[vis.length - 1];
    slider.value = current;
    pageInput.value = current;
    const pct = Math.round((last / N) * 100);
    $("#pct").textContent = `${pct}%`;
    slider.style.setProperty("--fill", `${pct}%`);
    const marked = bookmarks.some((b) => vis.includes(b.page));
    $("#bm-toggle").classList.toggle("on", marked);
    $("#bm-toggle").innerHTML = icon("bookmark", marked ? "filled" : "");
  }

  function goTo(p, { fromTTS = false, direction = 0 } = {}) {
    p = Math.max(1, Math.min(N, Math.round(p) || 1));
    if (spreadActive() && p !== 1) p = p % 2 === 0 ? p : p - 1;
    if (p === current && pagesEl.childElementCount) return;
    const dir = direction || Math.sign(p - current);
    current = p;
    renderPages(dir);
    updateUI();
    persist();
    if (!fromTTS && tts && tts.state === "playing") tts.start(visiblePages()[0]);
    if (!sampleMode && Math.max(...visiblePages()) >= N) finishedBook();
  }

  const next = () => {
    if (Math.max(...visiblePages()) >= N) { if (sampleMode) sampleEnd(); return; }
    goTo(current + step(), { direction: 1 });
  };
  const prev = () => goTo(current - (spreadActive() && current > 1 ? (current === 2 ? 1 : 2) : 1), { direction: -1 });
  // physical left/right → logical next/prev depends on book direction
  const goLeft = () => (bookRTL ? next() : prev());
  const goRight = () => (bookRTL ? prev() : next());

  $("#zone-left").onclick = goLeft; $("#zone-right").onclick = goRight;
  $("#btn-left").onclick = goLeft; $("#btn-right").onclick = goRight;
  slider.oninput = () => { pageInput.value = slider.value; };
  slider.onchange = () => goTo(Number(slider.value));
  pageInput.onchange = () => goTo(Number(pageInput.value));

  on(document, "keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowLeft": goLeft(); break;
      case "ArrowRight": goRight(); break;
      case "PageDown": case " ": next(); break;
      case "PageUp": prev(); break;
      case "Home": goTo(1); break;
      case "End": goTo(N); break;
      case "+": case "=": zoom(0.15); break;
      case "-": zoom(-0.15); break;
      case "Escape": closePanel(); break;
      default: return;
    }
    e.preventDefault();
  });

  // touch swipe (only when the page is not zoomed-in)
  let touch = null;
  on(stage, "touchstart", (e) => { if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
  on(stage, "touchend", (e) => {
    if (!touch || pagesEl.classList.contains("zoomed")) { touch = null; return; }
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - touch.t < 700) (dx < 0 ? goRight : goLeft)();
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && window.getSelection().isCollapsed) readerEl.classList.toggle("chrome-hidden");
    touch = null;
  }, { passive: true });

  on(window, "resize", debounce(() => { canvasCache.clear(); renderPages(); updateUI(); }, 200));

  // ------------------------------------------------------------------ progress
  const persist = debounce(() => {
    if (sampleMode) return;
    const last = Math.max(...visiblePages());
    saveProgress(book.id, last, N).catch(() => {});
  }, 1200);
  on(window, "pagehide", () => { if (!sampleMode) saveProgress(book.id, Math.max(...visiblePages()), N).catch(() => {}); });

  let finishedShown = false;
  function finishedBook() {
    if (finishedShown) return;
    finishedShown = true;
    toast(t("finishedBook"), "success", 5000);
  }

  function sampleEnd() {
    const m = modal({
      title: t("endOfSample"),
      body: `<div class="center stack">${coverHTML(book, "small")}<p>${esc(t("endOfSampleText"))}</p>
        <button class="btn btn-primary btn-lg" id="sample-buy">${icon("cart")} ${esc(t("buyNow"))}</button></div>`,
    });
    m.body.querySelector("#sample-buy").onclick = () => {
      m.close();
      if (!state.user) { location.hash = `#/login?next=${encodeURIComponent(`/read/${book.slug}`)}`; return; }
      openCheckout(book, { onSuccess: () => window.dispatchEvent(new HashChangeEvent("hashchange")) });
    };
  }

  // ------------------------------------------------------------------ zoom / theme / fullscreen
  function zoom(delta) {
    S.zoom = Math.min(4, Math.max(0.5, +(S.zoom + delta).toFixed(2)));
    saveSettings(); canvasCache.clear(); renderPages();
    const z = root.querySelector("#zoom-val"); if (z) z.textContent = `${Math.round(S.zoom * 100)}%`;
  }
  $("#fs-btn").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else readerEl.requestFullscreen?.().catch(() => {});
  };
  $("#dl-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await downloadBook(book); toast(t("downloadStarted"), "success"); }
    catch (err) { toast(err.message, "error"); } finally { btn.disabled = false; }
  });

  // ------------------------------------------------------------------ panels
  const panel = $("#panel"), panelBody = $("#panel-body"), panelTitle = $("#panel-title");
  let openPanelName = null;
  function closePanel() {
    panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); openPanelName = null;
    root.querySelectorAll("[data-panel]").forEach((b) => b.classList.remove("active"));
  }
  function openPanel(name) {
    if (openPanelName === name) { closePanel(); return; }
    openPanelName = name;
    root.querySelectorAll("[data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
    ({ toc: panelToc, search: panelSearch, bookmarks: panelBookmarks, settings: panelSettings })[name]();
  }
  root.querySelectorAll("[data-panel]").forEach((b) => (b.onclick = () => openPanel(b.dataset.panel)));
  $("#panel-close").onclick = closePanel;

  // ---- table of contents + page thumbnails
  let outlineCache = null;
  async function panelToc(view = "toc") {
    panelTitle.textContent = t("contents");
    panelBody.innerHTML = `<div class="seg small"><label><input type="radio" name="tocv" value="toc" ${view === "toc" ? "checked" : ""}/> <span>${esc(t("chapters"))}</span></label>
      <label><input type="radio" name="tocv" value="thumbs" ${view === "thumbs" ? "checked" : ""}/> <span>${esc(t("pagesView"))}</span></label></div>
      <div id="toc-content"><div class="page-loading small"><span class="spinner"></span></div></div>`;
    panelBody.querySelectorAll('[name="tocv"]').forEach((r) => (r.onchange = () => panelToc(r.value)));
    const box = panelBody.querySelector("#toc-content");
    if (view === "thumbs") return renderThumbs(box);
    if (!outlineCache) outlineCache = await buildOutline();
    if (!outlineCache.length) { renderThumbs(box, true); return; }
    const renderItems = (items) => `<ul class="toc-list" dir="${bookRTL ? "rtl" : "ltr"}">${items.map((it) => `
      <li><button class="toc-item ${it.page && visiblePages().includes(it.page) ? "current" : ""}" data-go="${it.page || ""}"><span>${esc(it.title)}</span>
        <span class="muted small">${it.page ? fmtNumber(it.page) : ""}</span></button>
        ${it.items?.length ? renderItems(it.items) : ""}</li>`).join("")}</ul>`;
    box.innerHTML = renderItems(outlineCache);
    box.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { if (b.dataset.go) { goTo(Number(b.dataset.go)); if (window.innerWidth < 900) closePanel(); } }));
  }

  async function buildOutline() {
    const outline = await pdf.getOutline().catch(() => null);
    if (!outline) return [];
    const resolve = async (items) => Promise.all(items.map(async (it) => {
      let page = null;
      try {
        const dest = typeof it.dest === "string" ? await pdf.getDestination(it.dest) : it.dest;
        if (dest?.[0]) page = typeof dest[0] === "number" ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1;
      } catch {}
      return { title: it.title, page, items: it.items?.length ? await resolve(it.items) : [] };
    }));
    return resolve(outline);
  }

  function renderThumbs(box, noToc = false) {
    box.innerHTML = `${noToc ? `<p class="muted small">${esc(t("noToc"))}</p>` : ""}
      <div class="thumbs">${Array.from({ length: N }, (_, i) => `<button class="thumb ${visiblePages().includes(i + 1) ? "current" : ""}" data-thumb="${i + 1}">
        <div class="thumb-img"></div><span>${fmtNumber(i + 1)}</span></button>`).join("")}</div>`;
    const io = new IntersectionObserver((entries) => entries.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const n = Number(en.target.dataset.thumb);
      try {
        const { canvas } = await renderPageToCanvas(await getPage(n), { width: 110 });
        en.target.querySelector(".thumb-img").appendChild(canvas);
      } catch {}
    }), { root: panelBody, rootMargin: "200px" });
    box.querySelectorAll("[data-thumb]").forEach((b) => {
      io.observe(b);
      b.onclick = () => { goTo(Number(b.dataset.thumb)); if (window.innerWidth < 900) closePanel(); };
    });
    box.querySelector(".thumb.current")?.scrollIntoView({ block: "center" });
  }

  // ---- search
  let searchToken = 0;
  function panelSearch() {
    panelTitle.textContent = t("searchInBook");
    panelBody.innerHTML = `<form id="sform" class="search-form"><div class="input-icon">${icon("search")}
      <input class="input" name="q" value="${esc(searchQuery)}" placeholder="${esc(t("searchInBookPh"))}" dir="auto" autocomplete="off" /></div></form>
      <p class="muted small" id="sstatus"></p><ol class="search-results" id="sresults"></ol>`;
    const form = panelBody.querySelector("#sform");
    form.q.focus();
    form.onsubmit = (e) => { e.preventDefault(); runSearch(form.q.value.trim()); };
    if (searchQuery) runSearch(searchQuery);
  }
  async function runSearch(q) {
    const my = ++searchToken;
    searchQuery = q;
    const status = panelBody.querySelector("#sstatus"), list = panelBody.querySelector("#sresults");
    if (!list) return;
    list.innerHTML = "";
    if (q.length < 2) { status.textContent = ""; renderPages(); return; }
    const needle = q.normalize("NFKC").toLowerCase();
    let count = 0;
    for (let n = 1; n <= N; n++) {
      if (my !== searchToken) return;
      if (n % 10 === 1) status.textContent = t("searching", { page: n, total: N });
      const text = (await getText(n)).replace(/\n/g, " ");
      const lower = text.toLowerCase();
      let idx = lower.indexOf(needle);
      let perPage = 0;
      while (idx !== -1 && perPage < 5 && count < 300) {
        const s = Math.max(0, idx - 40), e = Math.min(text.length, idx + needle.length + 40);
        list.insertAdjacentHTML("beforeend", `<li><button data-go="${n}" dir="auto"><span class="muted small">${esc(t("page"))} ${fmtNumber(n)}</span>
          <span>${s > 0 ? "…" : ""}${esc(text.slice(s, idx))}<mark>${esc(text.slice(idx, idx + needle.length))}</mark>${esc(text.slice(idx + needle.length, e))}${e < text.length ? "…" : ""}</span></button></li>`);
        count++; perPage++;
        idx = lower.indexOf(needle, idx + needle.length);
      }
    }
    if (my !== searchToken) return;
    status.textContent = count ? t("resultsFound", { n: fmtNumber(count) }) : t("noResults");
    list.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { goTo(Number(b.dataset.go)); renderPages(); if (window.innerWidth < 900) closePanel(); }));
    renderPages();
  }

  // ---- bookmarks
  async function loadBookmarks() {
    bookmarks = await listBookmarks(book.id).catch(() => []);
    updateUI();
  }
  async function toggleBookmark() {
    const vis = visiblePages();
    const existing = bookmarks.find((b) => vis.includes(b.page));
    try {
      if (existing) { await removeBookmark(book.id, existing.id); toast(t("bookmarkRemoved")); }
      else { await addBookmark(book.id, vis[0]); toast(t("bookmarkAdded"), "success"); }
      await loadBookmarks();
      if (openPanelName === "bookmarks") panelBookmarks();
    } catch (e) { toast(e.message, "error"); }
  }
  $("#bm-toggle").onclick = toggleBookmark;

  function panelBookmarks() {
    panelTitle.textContent = t("bookmarks");
    panelBody.innerHTML = `
      <button class="btn btn-primary btn-sm btn-block" id="bm-add">${icon("plus")} ${esc(t("bookmarkThisPage"))}</button>
      ${!state.user ? `<p class="muted small">${esc(t("bookmarksGuestNote"))}</p>` : ""}
      ${bookmarks.length ? `<ul class="bm-list">${bookmarks.map((b) => `
        <li><button class="bm-go" data-go="${b.page}">${icon("bookmark", "filled")} <strong>${esc(t("page"))} ${fmtNumber(b.page)}</strong>
          <span class="muted small">${esc(fmtDate(b.created_at))}</span></button>
          ${b.note ? `<p class="bm-note" dir="auto">${esc(b.note)}</p>` : ""}
          <div class="bm-actions"><button class="link-btn small" data-note="${b.id}">${icon("edit")} ${esc(t("note"))}</button>
          <button class="link-btn small danger" data-rm="${b.id}">${icon("trash")} ${esc(t("delete"))}</button></div></li>`).join("")}</ul>`
        : `<p class="muted center">${esc(t("noBookmarks"))}</p>`}`;
    panelBody.querySelector("#bm-add").onclick = async () => {
      const note = await promptDialog(t("addNoteOptional"), { multiline: true, placeholder: t("notePlaceholder") });
      if (note === null) return;
      try { await addBookmark(book.id, visiblePages()[0], note.trim()); toast(t("bookmarkAdded"), "success"); await loadBookmarks(); panelBookmarks(); }
      catch (e) { toast(e.message, "error"); }
    };
    panelBody.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { goTo(Number(b.dataset.go)); if (window.innerWidth < 900) closePanel(); }));
    panelBody.querySelectorAll("[data-note]").forEach((b) => (b.onclick = async () => {
      const bm = bookmarks.find((x) => x.id === b.dataset.note);
      const note = await promptDialog(t("note"), { value: bm.note || "", multiline: true });
      if (note === null) return;
      await updateBookmark(book.id, bm.id, note.trim()); await loadBookmarks(); panelBookmarks();
    }));
    panelBody.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog(t("deleteBookmarkConfirm"), { danger: true, okText: t("delete") }))) return;
      await removeBookmark(book.id, b.dataset.rm); await loadBookmarks(); panelBookmarks();
    }));
  }

  // ---- settings
  function panelSettings() {
    panelTitle.textContent = t("readerSettings");
    panelBody.innerHTML = `
      <div class="field"><span>${esc(t("theme"))}</span>
        <div class="theme-swatches">
          ${["light", "sepia", "dark"].map((th) => `<button class="swatch sw-${th} ${S.theme === th ? "active" : ""}" data-theme="${th}">${esc(t("theme_" + th))}</button>`).join("")}
        </div></div>
      <div class="field"><span>${esc(t("brightness"))}</span><input type="range" min="50" max="100" value="${S.brightness}" id="bright" /></div>
      <div class="field"><span>${esc(t("fit"))}</span>
        <div class="seg"><label><input type="radio" name="fit" value="page" ${S.fit === "page" ? "checked" : ""}/> <span>${esc(t("fitPage"))}</span></label>
        <label><input type="radio" name="fit" value="width" ${S.fit === "width" ? "checked" : ""}/> <span>${esc(t("fitWidth"))}</span></label></div></div>
      <div class="field"><span>${esc(t("zoom"))}</span>
        <div class="row gap"><button class="icon-btn" id="z-out">${icon("zoomOut")}</button><strong id="zoom-val">${Math.round(S.zoom * 100)}%</strong>
        <button class="icon-btn" id="z-in">${icon("zoomIn")}</button><button class="link-btn small" id="z-reset">${esc(t("reset"))}</button></div></div>
      <label class="switch"><input type="checkbox" id="spread" ${S.spread ? "checked" : ""}/><span></span> ${esc(t("twoPages"))}</label>
      <p class="muted small">${esc(t("keyboardHint"))}</p>`;
    panelBody.querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => {
      S.theme = b.dataset.theme; saveSettings(); readerEl.dataset.rtheme = S.theme;
      panelBody.querySelectorAll("[data-theme]").forEach((x) => x.classList.toggle("active", x === b));
    }));
    panelBody.querySelector("#bright").oninput = (e) => { S.brightness = Number(e.target.value); readerEl.style.setProperty("--brightness", `${S.brightness}%`); saveSettings(); };
    panelBody.querySelectorAll('[name="fit"]').forEach((r) => (r.onchange = () => { S.fit = r.value; saveSettings(); canvasCache.clear(); renderPages(); }));
    panelBody.querySelector("#z-in").onclick = () => zoom(0.15);
    panelBody.querySelector("#z-out").onclick = () => zoom(-0.15);
    panelBody.querySelector("#z-reset").onclick = () => { S.zoom = 1; zoom(0); };
    panelBody.querySelector("#spread").onchange = (e) => { S.spread = e.target.checked; saveSettings(); canvasCache.clear(); const p = current; current = 0; goTo(p); };
  }

  // ------------------------------------------------------------------ auto reader (TTS)
  let tts = null;
  const ttsBar = $("#tts-bar");
  const ttsPlay = $("#tts-play");
  let wakeLock = null;

  async function setupTTS() {
    if (tts) return tts;
    tts = new AutoReader({
      lang: book.language,
      totalPages: N,
      getText,
      onPage: (p) => { if (!visiblePages().includes(p)) goTo(p, { fromTTS: true, direction: 1 }); },
      onState: (s) => {
        ttsPlay.innerHTML = icon(s === "playing" ? "pause" : "play");
        ttsPlay.setAttribute("aria-label", s === "playing" ? t("pause") : t("play"));
        $("#tts-btn").classList.toggle("on", s === "playing");
        if (s === "notext") $("#tts-text").innerHTML = `<span class="muted">${esc(t("ttsNoText"))}</span>`;
        if (s === "error") toast(t("ttsError"), "error");
        if (s === "playing") requestWake(); else releaseWake();
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = s === "playing" ? "playing" : "paused";
      },
      onSentence: ({ index, sentences }) => {
        const prevS = sentences[index - 1], cur = sentences[index], nextS = sentences[index + 1];
        $("#tts-text").innerHTML = `${prevS ? `<span class="faint">${esc(prevS)} </span>` : ""}<mark>${esc(cur)}</mark>${nextS ? `<span class="faint"> ${esc(nextS)}</span>` : ""}`;
      },
      onFinished: () => toast(t("finishedBook"), "success"),
    });

    const voices = voicesFor(await getVoices(), book.language);
    const sel = $("#tts-voice");
    if (!voices.length) {
      sel.innerHTML = `<option value="">${esc(t("defaultVoice"))}</option>`;
      toast(t("noVoiceForLang"), "info", 7000);
    } else {
      const saved = localStorage.getItem(`tts-voice-${book.language}`);
      sel.innerHTML = voices.map((v) => `<option value="${esc(v.name)}" ${v.name === saved ? "selected" : ""}>${esc(v.name.replace(/Microsoft |Google /, ""))} (${esc(v.lang)})</option>`).join("");
      tts.voice = voices.find((v) => v.name === saved) || voices[0];
      sel.value = tts.voice.name;
    }
    sel.onchange = () => tts.setVoice(voices.find((v) => v.name === sel.value));
    const rateSel = $("#tts-rate");
    rateSel.value = String(tts.rate);
    if (!rateSel.value) rateSel.value = "1";
    rateSel.onchange = () => tts.setRate(Number(rateSel.value));
    $("#tts-auto").checked = tts.autoTurn;
    $("#tts-auto").onchange = (e) => tts.setAutoTurn(e.target.checked);

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: book.title, artist: book.author, artwork: book.cover_url ? [{ src: book.cover_url, sizes: "512x512" }] : [] });
      navigator.mediaSession.setActionHandler("play", () => tts.toggle(visiblePages()[0]));
      navigator.mediaSession.setActionHandler("pause", () => tts.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => tts.next());
      navigator.mediaSession.setActionHandler("previoustrack", () => tts.prev());
    }
    return tts;
  }

  async function requestWake() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {} }
  function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }

  async function openTTS(autoplay = true) {
    if (!ttsSupported()) { toast(t("ttsUnsupported"), "error"); return; }
    ttsBar.hidden = false;
    readerEl.classList.add("tts-open");
    await setupTTS();
    if (autoplay && tts.state !== "playing") tts.toggle(visiblePages()[0]);
  }
  $("#tts-btn").onclick = () => (ttsBar.hidden ? openTTS(true) : tts?.toggle(visiblePages()[0]));
  ttsPlay.onclick = () => tts?.toggle(visiblePages()[0]);
  $("#tts-next").onclick = () => tts?.next();
  $("#tts-prev").onclick = () => tts?.prev();
  $("#tts-close").onclick = () => { tts?.stop(); ttsBar.hidden = true; readerEl.classList.remove("tts-open"); };

  // ------------------------------------------------------------------ start
  let startPage = Number(query.get("page")) || 1;
  if (!query.get("page") && !sampleMode) {
    const pr = await getProgress(book.id).catch(() => null);
    if (pr?.page > 1 && pr.page <= N) {
      startPage = pr.finished && pr.page >= N ? 1 : pr.page;
      if (startPage > 1) toast(t("resumedAt", { page: fmtNumber(startPage) }), "info");
    }
  }
  if (!isCurrent()) { pdf.destroy(); return; }
  current = 0;
  goTo(startPage);
  if (startPage >= N && !sampleMode) finishedShown = true;
  loadBookmarks();
  if (query.get("listen") === "1") openTTS(true);
  if (sampleMode) toast(t("readingSample", { n: fmtNumber(N) }), "info", 5000);

  // ------------------------------------------------------------------ cleanup
  return () => {
    cleanups.forEach((fn) => fn());
    tts?.destroy();
    releaseWake();
    if ("mediaSession" in navigator) ["play", "pause", "nexttrack", "previoustrack"].forEach((a) => { try { navigator.mediaSession.setActionHandler(a, null); } catch {} });
    if (!sampleMode && current) saveProgress(book.id, Math.max(...visiblePages()), N).catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    pdf.destroy();
  };
}

function renderLocked(root, book) {
  root.innerHTML = `<div class="container narrow"><div class="locked card center stack">
    ${coverHTML(book, "small")}
    <h2 dir="auto">${esc(book.title)}</h2>
    <p class="muted">${icon("lock")} ${esc(t("lockedText"))}</p>
    <div class="row gap center">
      <button class="btn btn-primary btn-lg" id="buy">${icon("cart")} ${esc(t("buyNow"))}</button>
      <a class="btn btn-ghost btn-lg" href="#/book/${encodeURIComponent(book.slug)}">${esc(t("back"))}</a>
    </div></div></div>`;
  root.querySelector("#buy").onclick = () => {
    if (!state.user) { location.hash = `#/login?next=${encodeURIComponent(`/read/${book.slug}`)}`; return; }
    openCheckout(book, { onSuccess: () => window.dispatchEvent(new HashChangeEvent("hashchange")) });
  };
}
