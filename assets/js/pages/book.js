import { t, fmtNumber, fmtDate, fmtPrice, LANG_NAMES } from "../i18n.js";
import { state, isAdmin } from "../store.js";
import {
  esc, icon, coverHTML, starsHTML, langBadge, bookCard, toast, setTitle, emptyState, formatBytes, confirmDialog,
} from "../ui.js";
import {
  getBook, hasAccess, getProgress, getWishlistIds, toggleWishlist, listReviews, saveReview, deleteReview,
  relatedBooks, downloadBook, bumpStat, getOwnedIds,
} from "../api.js";
import { openCheckout } from "../payments/paypal.js";

export default async function render({ root, params, isCurrent }) {
  const book = await getBook(params.slug);
  if (!isCurrent()) return;
  if (!book) {
    root.innerHTML = `<div class="container narrow">${emptyState(t("bookNotFound"), "", `<a class="btn btn-primary" href="#/books">${esc(t("browseBooks"))}</a>`)}</div>`;
    return;
  }
  setTitle(book.title, book.author);
  bumpStat(book.id, "views");

  const [access, progress, wish, reviews, related, owned] = await Promise.all([
    hasAccess(book).catch(() => false),
    getProgress(book.id).catch(() => null),
    getWishlistIds().catch(() => new Set()),
    listReviews(book.id).catch(() => []),
    relatedBooks(book).catch(() => []),
    getOwnedIds().catch(() => new Set()),
  ]);
  if (!isCurrent()) return;

  const isPaid = Number(book.price) > 0;
  const bookDir = book.language === "ar" ? "rtl" : "ltr";
  let inWishlist = wish.has(book.id);
  const myReview = reviews.find((r) => r.user_id === state.user?.id);

  const readLabel = progress?.page > 1
    ? t("continueAtPage", { page: fmtNumber(progress.page) })
    : t("readNow");

  const actions = access
    ? `<a class="btn btn-primary btn-lg" href="#/read/${encodeURIComponent(book.slug)}">${icon("book")} ${esc(readLabel)}</a>
       ${book.allow_download && book.file_path ? `<button class="btn btn-ghost btn-lg" id="dl-btn">${icon("download")} <span>${esc(t("downloadPdf"))}</span></button>` : ""}
       <a class="btn btn-ghost btn-lg" href="#/read/${encodeURIComponent(book.slug)}?listen=1">${icon("volume")} ${esc(t("listen"))}</a>`
    : `<button class="btn btn-primary btn-lg" id="buy-btn">${icon("cart")} ${esc(t("buyFor", { price: priceText(book) }))}</button>
       ${book.sample_url ? `<a class="btn btn-ghost btn-lg" href="#/read/${encodeURIComponent(book.slug)}?sample=1">${icon("eye")} ${esc(t("readSample"))}</a>` : ""}`;

  const meta = [
    [t("language"), LANG_NAMES[book.language]],
    [t("pages"), book.page_count ? fmtNumber(book.page_count) : ""],
    [t("category"), book.category],
    [t("publisher"), book.publisher],
    [t("year"), book.published_year],
    ["ISBN", book.isbn],
    [t("fileSize"), formatBytes(book.file_size)],
    [t("publishedOn"), fmtDate(book.published_at)],
  ].filter(([, v]) => v);

  root.innerHTML = `
  <div class="container book-page">
    <nav class="breadcrumb"><a href="#/books">${esc(t("navBooks"))}</a> <span>/</span> <span dir="auto">${esc(book.title)}</span></nav>

    <div class="book-hero">
      <div class="book-hero-cover">
        <div class="book-3d">${coverHTML(book)}</div>
        ${access && progress ? `<div class="progress-line big"><span style="width:${Math.max(2, Math.round(progress.percent || 0))}%"></span></div>
          <p class="muted small center">${esc(t("percentRead", { pct: Math.round(progress.percent || 0) }))}</p>` : ""}
      </div>

      <div class="book-hero-info">
        <div class="badges-row">${langBadge(book.language)} ${book.category ? `<a class="badge" href="#/books?category=${encodeURIComponent(book.category)}">${esc(book.category)}</a>` : ""}
          ${!book.is_published ? `<span class="badge badge-warn">${esc(t("draft"))}</span>` : ""}</div>
        <h1 class="book-title" dir="${bookDir}">${esc(book.title)}</h1>
        ${book.subtitle ? `<p class="book-subtitle" dir="${bookDir}">${esc(book.subtitle)}</p>` : ""}
        <p class="book-author">${esc(t("by"))} <strong>${esc(book.author)}</strong></p>
        <div class="book-stats">
          ${starsHTML(book.rating_avg, book.rating_count)}
          <span>${icon("eye")} ${fmtNumber(book.views)}</span>
          ${book.allow_download ? `<span>${icon("download")} ${fmtNumber(book.downloads)}</span>` : ""}
        </div>

        <div class="price-block">
          ${access && isPaid && !isAdmin() ? `<span class="badge badge-owned">${icon("check")} ${esc(t("youOwnThis"))}</span>`
            : `<span class="price-big ${isPaid ? "" : "free"}">${esc(priceText(book))}</span>`}
        </div>

        <div class="book-actions">${actions}</div>
        <div class="book-secondary-actions">
          <button class="link-btn" id="wish-btn">${icon("heart", inWishlist ? "filled" : "")} <span>${esc(inWishlist ? t("inWishlist") : t("addWishlist"))}</span></button>
          <button class="link-btn" id="share-btn">${icon("share")} ${esc(t("share"))}</button>
          ${isAdmin() ? `<a class="link-btn" href="#/admin/book/${book.id}">${icon("edit")} ${esc(t("edit"))}</a>` : ""}
        </div>

        <dl class="meta-list">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      </div>
    </div>

    <section class="book-section">
      <h2>${esc(t("aboutBook"))}</h2>
      <div class="description" dir="${bookDir}">${esc(book.description || t("noDescription"))}</div>
      ${book.tags?.length ? `<div class="tags">${book.tags.map((tag) => `<a class="tag" href="#/books?q=${encodeURIComponent(tag)}">#${esc(tag)}</a>`).join("")}</div>` : ""}
    </section>

    <section class="book-section" id="reviews">
      <h2>${esc(t("reviews"))} <span class="muted">(${fmtNumber(reviews.length)})</span></h2>
      <div id="review-form-wrap"></div>
      <div class="reviews-list">
        ${reviews.length ? reviews.map(reviewHTML).join("") : `<p class="muted">${esc(t("noReviews"))}</p>`}
      </div>
    </section>

    ${related.length ? `<section class="book-section"><h2>${esc(t("youMayLike"))}</h2>
      <div class="book-row">${related.map((b) => bookCard(b, { owned: owned.has(b.id) })).join("")}</div></section>` : ""}
  </div>`;

  // ---- download
  const dl = root.querySelector("#dl-btn");
  if (dl) dl.onclick = async () => {
    dl.disabled = true;
    const label = dl.querySelector("span");
    try {
      await downloadBook(book, (p) => (label.textContent = `${p}%`));
      toast(t("downloadStarted"), "success");
    } catch (e) { toast(e.message || t("errDownload"), "error"); }
    finally { dl.disabled = false; label.textContent = t("downloadPdf"); }
  };

  // ---- buy
  const buy = root.querySelector("#buy-btn");
  if (buy) buy.onclick = () => {
    if (!state.user) { toast(t("loginToBuy")); location.hash = `#/login?next=${encodeURIComponent(`/book/${book.slug}`)}`; return; }
    openCheckout(book, { onSuccess: () => { location.hash = `#/read/${encodeURIComponent(book.slug)}`; } });
  };

  // ---- wishlist
  root.querySelector("#wish-btn").onclick = async (e) => {
    if (!state.user) { toast(t("loginRequired")); location.hash = `#/login?next=${encodeURIComponent(`/book/${book.slug}`)}`; return; }
    const btn = e.currentTarget;
    try {
      inWishlist = !inWishlist;
      await toggleWishlist(book.id, inWishlist);
      btn.innerHTML = `${icon("heart", inWishlist ? "filled" : "")} <span>${esc(inWishlist ? t("inWishlist") : t("addWishlist"))}</span>`;
      toast(inWishlist ? t("addedWishlist") : t("removedWishlist"));
    } catch (err) { inWishlist = !inWishlist; toast(err.message, "error"); }
  };

  // ---- share
  root.querySelector("#share-btn").onclick = async () => {
    const url = location.href.split("?")[0];
    try {
      if (navigator.share) await navigator.share({ title: book.title, text: book.author, url });
      else { await navigator.clipboard.writeText(url); toast(t("linkCopied"), "success"); }
    } catch {}
  };

  // ---- reviews
  renderReviewForm(root.querySelector("#review-form-wrap"), book, myReview);
  root.querySelectorAll("[data-del-review]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t("deleteReviewConfirm"), { danger: true, okText: t("delete") }))) return;
    await deleteReview(b.dataset.delReview);
    toast(t("reviewDeleted"));
    rerender();
  }));
}

const priceText = (book) => fmtPrice(book.price, book.currency);
const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

function reviewHTML(r) {
  const mine = r.user_id === state.user?.id;
  return `<article class="review">
    <div class="review-head">
      <span class="avatar small">${esc((r.user_name || "?")[0].toUpperCase())}</span>
      <div><strong>${esc(r.user_name || t("reader"))}</strong> ${mine ? `<span class="badge">${esc(t("you"))}</span>` : ""}
        <div class="muted small">${esc(fmtDate(r.created_at))}</div></div>
      <div class="review-stars">${starsHTML(r.rating)}</div>
    </div>
    ${r.comment ? `<p dir="auto">${esc(r.comment)}</p>` : ""}
    ${mine || isAdmin() ? `<button class="link-btn danger small" data-del-review="${r.id}">${icon("trash")} ${esc(t("delete"))}</button>` : ""}
  </article>`;
}

function renderReviewForm(wrap, book, mine) {
  if (!state.user) {
    wrap.innerHTML = `<p class="muted"><a href="#/login?next=${encodeURIComponent(`/book/${book.slug}`)}">${esc(t("login"))}</a> ${esc(t("toWriteReview"))}</p>`;
    return;
  }
  let rating = mine?.rating || 0;
  wrap.innerHTML = `
    <form class="review-form card">
      <strong>${esc(mine ? t("editYourReview") : t("writeReview"))}</strong>
      <div class="star-picker" role="radiogroup" aria-label="${esc(t("rating"))}">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n}">${icon("star")}</button>`).join("")}
      </div>
      <textarea class="input" name="comment" rows="3" maxlength="2000" dir="auto" placeholder="${esc(t("reviewPlaceholder"))}">${esc(mine?.comment || "")}</textarea>
      <div><button class="btn btn-primary btn-sm">${esc(t("submitReview"))}</button></div>
    </form>`;
  const stars = wrap.querySelectorAll("[data-star]");
  const paint = (n) => stars.forEach((s) => s.classList.toggle("on", Number(s.dataset.star) <= n));
  paint(rating);
  stars.forEach((s) => {
    s.onclick = () => { rating = Number(s.dataset.star); paint(rating); };
    s.onmouseenter = () => paint(Number(s.dataset.star));
    s.onmouseleave = () => paint(rating);
  });
  wrap.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (!rating) { toast(t("pickRating"), "error"); return; }
    try {
      await saveReview(book.id, rating, e.target.comment.value.trim());
      toast(t("reviewSaved"), "success");
      rerender();
    } catch (err) { toast(err.message, "error"); }
  };
}
