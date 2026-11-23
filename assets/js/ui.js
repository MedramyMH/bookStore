// UI helpers: escaping, icons, toasts, modals, book cards
import { t, fmtPrice, isRTL } from "./i18n.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export const debounce = (fn, ms = 300) => {
  let id;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
};

// ---------------------------------------------------------------- icons
const P = {
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h13"/><path d="M8 7h7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9Z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  play: '<path d="M7 4v16l13-8Z" fill="currentColor"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>',
  skipNext: '<path d="M5 5v14l10-7Z" fill="currentColor"/><path d="M18 5v14"/>',
  skipPrev: '<path d="M19 5v14L9 12Z" fill="currentColor"/><path d="M6 5v14"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevD: '<path d="m5 9 7 7 7-7"/>',
  arrowL: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11L21 7H6.2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  file: '<path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 8 4s0 4 4 4ZM12 8s1.5-5 4-4 0 4-4 4Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  google: '<path d="M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.1 2.7-7Z" fill="#4285F4" stroke="none"/><path d="M12 21.5c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.5-1.7-5.3-3.9H3.5v2.5A9.5 9.5 0 0 0 12 21.5Z" fill="#34A853" stroke="none"/><path d="M6.7 13.8a5.7 5.7 0 0 1 0-3.6V7.7H3.5a9.5 9.5 0 0 0 0 8.6Z" fill="#FBBC05" stroke="none"/><path d="M12 6.3c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9.5 9.5 0 0 0 3.5 7.7l3.2 2.5C7.5 8 9.5 6.3 12 6.3Z" fill="#EA4335" stroke="none"/>',
};

export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;

// ---------------------------------------------------------------- toasts
export function toast(message, type = "info", ms = 3500) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span>${esc(message)}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------------------------------------------------------- modal
export function modal({ title = "", body = "", wide = false, onClose } = {}) {
  const root = $("#modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="${esc(t("close"))}">${icon("close")}</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  const bodyEl = $(".modal-body", wrap);
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const close = () => {
    document.removeEventListener("keydown", onKey);
    wrap.classList.remove("show");
    setTimeout(() => wrap.remove(), 200);
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) close();
  });
  $("button, input, textarea, select", bodyEl)?.focus?.();
  return { el: wrap, body: bodyEl, close };
}

export function confirmDialog(message, { okText = t("confirm"), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: t("areYouSure"),
      body: `<p class="muted">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-no>${esc(t("cancel"))}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(okText)}</button>
        </div>`,
      onClose: () => !done && resolve(false),
    });
    $("[data-no]", m.el).onclick = () => { done = true; resolve(false); m.close(); };
    $("[data-yes]", m.el).onclick = () => { done = true; resolve(true); m.close(); };
  });
}

export function promptDialog(title, { value = "", placeholder = "", multiline = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const field = multiline
      ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
    const m = modal({
      title,
      body: `${field}<div class="modal-actions">
          <button class="btn btn-ghost" data-no>${esc(t("cancel"))}</button>
          <button class="btn btn-primary" data-yes>${esc(t("save"))}</button></div>`,
      onClose: () => !done && resolve(null),
    });
    const input = $(".input", m.el);
    input.focus();
    $("[data-no]", m.el).onclick = () => m.close();
    $("[data-yes]", m.el).onclick = () => { done = true; resolve(input.value); m.close(); };
  });
}

// ---------------------------------------------------------------- books
const PALETTES = [
  ["#1d3557", "#e9c46a"], ["#3d405b", "#f2cc8f"], ["#264653", "#e76f51"],
  ["#5f0f40", "#fb8b24"], ["#0b3954", "#bfd7ea"], ["#2b2d42", "#ef233c"], ["#283618", "#dda15e"],
];

function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/** Cover image, or a typographic generated cover when there is none */
export function coverHTML(book, cls = "") {
  if (book.cover_url) {
    return `<img class="cover ${cls}" src="${esc(book.cover_url)}" alt="${esc(book.title)}" loading="lazy" decoding="async" />`;
  }
  const [bg, fg] = PALETTES[hash(book.id || book.title) % PALETTES.length];
  return `<div class="cover cover-generated ${cls}" style="--c-bg:${bg};--c-fg:${fg}" dir="${book.language === "ar" ? "rtl" : "ltr"}">
      <span class="cg-title">${esc(book.title)}</span>
      <span class="cg-rule"></span>
      <span class="cg-author">${esc(book.author || "")}</span>
    </div>`;
}

export function starsHTML(rating = 0, count) {
  const r = Math.round(Number(rating) * 2) / 2;
  let out = '<span class="stars" aria-label="' + esc(`${rating}/5`) + '">';
  for (let i = 1; i <= 5; i++) {
    const cls = r >= i ? "full" : r >= i - 0.5 ? "half" : "";
    out += `<span class="star ${cls}">${icon("star")}${cls === "half" ? `<span class="half-fill">${icon("star")}</span>` : ""}</span>`;
  }
  out += "</span>";
  if (count != null) out += `<span class="muted small">(${count})</span>`;
  return out;
}

export function priceBadge(book, owned = false) {
  if (owned && Number(book.price) > 0) return `<span class="badge badge-owned">${icon("check")} ${esc(t("owned"))}</span>`;
  return Number(book.price) > 0
    ? `<span class="badge badge-price">${esc(fmtPrice(book.price, book.currency))}</span>`
    : `<span class="badge badge-free">${esc(t("free"))}</span>`;
}

export function langBadge(code) {
  const label = { ar: "عربي", en: "EN", fr: "FR" }[code] ?? code;
  return `<span class="badge badge-lang" lang="${esc(code)}">${esc(label)}</span>`;
}

export function bookCard(book, { progress, owned } = {}) {
  const pct = progress ? Math.max(1, Math.round(progress.percent || 0)) : null;
  return `
  <article class="book-card">
    <a href="#/book/${encodeURIComponent(book.slug)}" class="book-card-link" aria-label="${esc(book.title)}">
      <div class="book-cover-wrap">
        ${coverHTML(book)}
        <div class="book-card-badges">${priceBadge(book, owned)}</div>
      </div>
      <div class="book-card-info" dir="auto">
        <h3 class="book-card-title">${esc(book.title)}</h3>
        <p class="book-card-author">${esc(book.author || "")}</p>
        <div class="book-card-meta">
          ${langBadge(book.language)}
          ${book.rating_count ? starsHTML(book.rating_avg) : ""}
        </div>
        ${pct != null ? `<div class="progress-line" title="${pct}%"><span style="width:${pct}%"></span></div>` : ""}
      </div>
    </a>
  </article>`;
}

export function skeletonGrid(n = 8) {
  return `<div class="book-grid">${Array.from({ length: n }, () =>
    `<div class="book-card skeleton"><div class="book-cover-wrap"><div class="cover"></div></div>
      <div class="book-card-info"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`).join("")}</div>`;
}

export function emptyState(title, text = "", actionHTML = "") {
  return `<div class="empty-state">${icon("book", "empty-icon")}<h3>${esc(title)}</h3>
    ${text ? `<p class="muted">${esc(text)}</p>` : ""}${actionHTML}</div>`;
}

export const chevStart = () => icon(isRTL() ? "chevR" : "chevL");
export const chevEnd = () => icon(isRTL() ? "chevL" : "chevR");

export function setTitle(...parts) {
  document.title = parts.filter(Boolean).join(" · ");
}

export function slugify(text) {
  const base = String(text).normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "book"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatBytes(b) {
  if (!b) return "";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
