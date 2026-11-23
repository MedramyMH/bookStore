import { CONFIG } from "../config.js";
import { t, tr, fmtNumber, isRTL } from "../i18n.js";
import { esc, icon, bookCard, skeletonGrid, coverHTML, setTitle, emptyState } from "../ui.js";
import { listBooks, listMyProgress, getOwnedIds } from "../api.js";

function shelf(id, title, link) {
  return `<section class="shelf" id="${id}">
    <div class="shelf-head"><h2>${esc(title)}</h2>${link ? `<a href="${link}" class="link-more">${esc(t("seeAll"))} ${isRTL() ? "←" : "→"}</a>` : ""}</div>
    <div class="shelf-body">${skeletonGrid(6)}</div>
  </section>`;
}

export default async function render({ root, isCurrent }) {
  setTitle(tr(CONFIG.SITE_NAME), tr(CONFIG.AUTHOR_NAME));
  root.innerHTML = `
  <section class="hero">
    <div class="container hero-inner">
      <div class="hero-text">
        <p class="eyebrow">${esc(t("heroEyebrow"))}</p>
        <h1 class="hero-title">${esc(t("heroTitle"))}</h1>
        <p class="hero-sub">${esc(tr(CONFIG.AUTHOR_BIO))}</p>
        <div class="hero-actions">
          <a href="#/books" class="btn btn-primary btn-lg">${icon("book")} ${esc(t("browseBooks"))}</a>
          <a href="#/books?price=free" class="btn btn-ghost btn-lg">${esc(t("readFree"))}</a>
        </div>
        <ul class="hero-features">
          <li>${icon("eye")} ${esc(t("featReadOnline"))}</li>
          <li>${icon("download")} ${esc(t("featDownload"))}</li>
          <li>${icon("volume")} ${esc(t("featListen"))}</li>
          <li>${icon("bookmark")} ${esc(t("featResume"))}</li>
        </ul>
      </div>
      <div class="hero-shelf" id="hero-covers" aria-hidden="true"></div>
    </div>
  </section>

  <div class="container">
    <section class="shelf" id="continue" hidden>
      <div class="shelf-head"><h2>${esc(t("continueReading"))}</h2><a href="#/library" class="link-more">${esc(t("seeAll"))} ${isRTL() ? "←" : "→"}</a></div>
      <div class="continue-row"></div>
    </section>
    ${shelf("featured", t("featuredBooks"), "#/books?sort=popular")}
    ${shelf("newest", t("newReleases"), "#/books?sort=newest")}
    ${shelf("free", t("freeBooks"), "#/books?price=free")}

    <section class="lang-tiles">
      <h2>${esc(t("browseByLanguage"))}</h2>
      <div class="tiles">
        <a href="#/books?language=ar" class="tile tile-ar" lang="ar"><span class="tile-glyph">ض</span><span>العربية</span></a>
        <a href="#/books?language=en" class="tile tile-en" lang="en"><span class="tile-glyph">Aa</span><span>English</span></a>
        <a href="#/books?language=fr" class="tile tile-fr" lang="fr"><span class="tile-glyph">Ç</span><span>Français</span></a>
      </div>
    </section>
  </div>`;

  const [owned, featured, newest, free, progress] = await Promise.all([
    getOwnedIds().catch(() => new Set()),
    listBooks({ featured: true, limit: 12, sort: "popular" }).catch(() => ({ data: [] })),
    listBooks({ sort: "newest", limit: 12 }).catch(() => ({ data: [] })),
    listBooks({ price: "free", sort: "popular", limit: 12 }).catch(() => ({ data: [] })),
    listMyProgress().catch(() => []),
  ]);
  if (!isCurrent()) return;

  const fill = (id, books) => {
    const body = root.querySelector(`#${id} .shelf-body`);
    if (!books.length) { root.querySelector(`#${id}`).hidden = true; return; }
    body.innerHTML = `<div class="book-row">${books.map((b) => bookCard(b, { owned: owned.has(b.id) })).join("")}</div>`;
  };

  // Featured falls back to most popular when nothing is marked as featured
  const featuredBooks = featured.data.length ? featured.data : (await listBooks({ sort: "popular", limit: 12 }).catch(() => ({ data: [] }))).data;
  fill("featured", featuredBooks);
  fill("newest", newest.data);
  fill("free", free.data);

  // hero cover stack
  const heroBooks = (featuredBooks.length ? featuredBooks : newest.data).slice(0, 3);
  root.querySelector("#hero-covers").innerHTML = heroBooks.length
    ? heroBooks.map((b, i) => `<a href="#/book/${encodeURIComponent(b.slug)}" class="hero-cover hc-${i}" tabindex="-1">${coverHTML(b)}</a>`).join("")
    : `<div class="hero-cover hc-0">${coverHTML({ id: "x", title: tr(CONFIG.SITE_NAME), author: tr(CONFIG.AUTHOR_NAME), language: "ar" })}</div>`;

  if (!newest.data.length) {
    root.querySelector("#newest").hidden = false;
    root.querySelector("#newest .shelf-body").innerHTML = emptyState(t("noBooksYet"), t("noBooksYetText"));
  }

  // Continue reading
  const inProgress = progress.filter((p) => !p.finished).slice(0, 4);
  if (inProgress.length) {
    const sec = root.querySelector("#continue");
    sec.hidden = false;
    sec.querySelector(".continue-row").innerHTML = inProgress.map((p) => `
      <a class="continue-card" href="#/read/${encodeURIComponent(p.book.slug)}">
        ${coverHTML(p.book, "small")}
        <div class="continue-info" dir="auto">
          <strong>${esc(p.book.title)}</strong>
          <span class="muted small">${esc(t("pageOf", { page: fmtNumber(p.page), total: fmtNumber(p.total_pages || "?") }))}</span>
          <div class="progress-line"><span style="width:${Math.max(2, Math.round(p.percent || 0))}%"></span></div>
          <span class="continue-cta">${icon("play")} ${esc(t("resume"))}</span>
        </div>
      </a>`).join("");
  }
}
