// App bootstrap: router, header, footer, theme, language
import { CONFIG, isConfigured } from "./config.js";
import { supabase } from "./supabase.js";
import { state, initAuth, onAuthChange, isAdmin } from "./store.js";
import { t, tr, getLang, setLang, onLangChange, applyLangToDocument, LANGS, LANG_NAMES } from "./i18n.js";
import { $, esc, icon, toast } from "./ui.js";
import { signOut, syncLocalProgress } from "./api.js";

// ---------------------------------------------------------------- theme
const THEME_KEY = "site-theme";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}
applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
applyLangToDocument();

// ---------------------------------------------------------------- routes
const routes = [
  { re: /^\/?$/, load: () => import("./pages/home.js") },
  { re: /^\/books$/, load: () => import("./pages/catalog.js") },
  { re: /^\/book\/([^/]+)$/, keys: ["slug"], load: () => import("./pages/book.js") },
  { re: /^\/read\/([^/]+)$/, keys: ["slug"], load: () => import("./pages/reader.js"), fullscreen: true },
  { re: /^\/library$/, load: () => import("./pages/library.js"), auth: false },
  { re: /^\/(login|register|forgot|reset)$/, keys: ["mode"], load: () => import("./pages/auth.js") },
  { re: /^\/account$/, load: () => import("./pages/account.js"), auth: true },
  { re: /^\/admin$/, load: () => import("./pages/admin.js"), admin: true },
  { re: /^\/admin\/book\/([^/]+)$/, keys: ["id"], load: () => import("./pages/admin-book.js"), admin: true },
  { re: /^\/about$/, load: () => import("./pages/about.js") },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: decodeURI(path), query: new URLSearchParams(qs) };
}

let cleanup = null;
let navToken = 0;

async function router() {
  const token = ++navToken;
  const { path, query } = parseHash();
  const main = $("#main");

  if (typeof cleanup === "function") { try { cleanup(); } catch {} }
  cleanup = null;

  let match = null, route = null;
  for (const r of routes) { match = path.match(r.re); if (match) { route = r; break; } }

  document.body.classList.toggle("reader-mode", !!route?.fullscreen);
  renderHeader();

  if (!route) { main.innerHTML = notFound(); return; }

  const params = {};
  (route.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));

  if ((route.auth || route.admin) && !state.user) {
    location.hash = `#/login?next=${encodeURIComponent(path)}`;
    return;
  }
  if (route.admin && !isAdmin()) { main.innerHTML = notFound(t("adminOnly")); return; }

  main.innerHTML = `<div class="page-loading"><span class="spinner"></span></div>`;
  try {
    const mod = await route.load();
    if (token !== navToken) return;
    const result = await mod.default({ root: main, params, query, isCurrent: () => token === navToken });
    if (token !== navToken) { if (typeof result === "function") result(); return; }
    cleanup = result;
    if (!route.fullscreen) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  } catch (err) {
    console.error(err);
    if (token === navToken) main.innerHTML = `<div class="container narrow"><div class="empty-state">
      <h3>${esc(t("errGeneric"))}</h3><p class="muted">${esc(err.message || err)}</p>
      <button class="btn btn-primary" onclick="location.reload()">${esc(t("retry"))}</button></div></div>`;
  }
  closeMobileMenu();
}

function notFound(msg) {
  return `<div class="container narrow"><div class="empty-state">
    <div class="big-404">404</div><h3>${esc(msg || t("notFound"))}</h3>
    <a class="btn btn-primary" href="#/">${esc(t("backHome"))}</a></div></div>`;
}

// ---------------------------------------------------------------- header
function activeClass(prefix) {
  const { path } = parseHash();
  return (prefix === "/" ? path === "/" || path === "" : path.startsWith(prefix)) ? "active" : "";
}

function renderHeader() {
  const h = $("#site-header");
  const user = state.user;
  const name = state.profile?.full_name || user?.email?.split("@")[0] || "";
  const dark = document.documentElement.dataset.theme === "dark";
  h.innerHTML = `
  <div class="container header-inner">
    <a href="#/" class="brand" aria-label="${esc(tr(CONFIG.SITE_NAME))}">
      <img class="brand-logo" src="assets/img/logo-icon.png" alt="" width="40" height="40" decoding="async" />
      <span class="brand-name">${esc(tr(CONFIG.SITE_NAME))}</span>
    </a>
    <nav class="main-nav" id="main-nav" aria-label="Main">
      <a href="#/" class="${activeClass("/")}">${esc(t("navHome"))}</a>
      <a href="#/books" class="${activeClass("/books")}">${esc(t("navBooks"))}</a>
      <a href="#/library" class="${activeClass("/library")}">${esc(t("navLibrary"))}</a>
      <a href="#/about" class="${activeClass("/about")}">${esc(t("navAbout"))}</a>
      ${isAdmin() ? `<a href="#/admin" class="nav-admin ${activeClass("/admin")}">${esc(t("navAdmin"))}</a>` : ""}
    </nav>
    <div class="header-actions">
      <form class="header-search" role="search" id="header-search">
        <input type="search" name="q" placeholder="${esc(t("searchPlaceholder"))}" aria-label="${esc(t("search"))}" />
        <button class="icon-btn" aria-label="${esc(t("search"))}">${icon("search")}</button>
      </form>
      <div class="dropdown" id="lang-dd">
        <button class="icon-btn" aria-haspopup="true" aria-label="${esc(t("language"))}" title="${esc(t("language"))}">${icon("globe")}<span class="lang-code">${getLang().toUpperCase()}</span></button>
        <div class="dropdown-menu">
          ${LANGS.map((l) => `<button data-lang="${l}" class="${l === getLang() ? "active" : ""}" lang="${l}">${LANG_NAMES[l]}</button>`).join("")}
        </div>
      </div>
      <button class="icon-btn" id="theme-toggle" aria-label="${esc(t("toggleTheme"))}" title="${esc(t("toggleTheme"))}">${icon(dark ? "sun" : "moon")}</button>
      ${user ? `
        <div class="dropdown" id="user-dd">
          <button class="avatar-btn" aria-haspopup="true" aria-label="${esc(t("account"))}"><span class="avatar">${esc((name[0] || "?").toUpperCase())}</span></button>
          <div class="dropdown-menu">
            <div class="dd-head"><strong>${esc(name)}</strong><small class="muted">${esc(user.email || "")}</small></div>
            <a href="#/library">${icon("book")} ${esc(t("navLibrary"))}</a>
            <a href="#/account">${icon("user")} ${esc(t("account"))}</a>
            ${isAdmin() ? `<a href="#/admin">${icon("chart")} ${esc(t("navAdmin"))}</a>` : ""}
            <button id="logout-btn">${icon("logout")} ${esc(t("logout"))}</button>
          </div>
        </div>` : `<a href="#/login" class="btn btn-primary btn-sm">${esc(t("login"))}</a>`}
      <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="${esc(t("menu"))}">${icon("menu")}</button>
    </div>
  </div>`;

  $("#header-search", h).onsubmit = (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q").toString().trim();
    location.hash = `#/books${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  };
  $("#theme-toggle", h).onclick = () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    renderHeader();
  };
  h.querySelectorAll(".dropdown").forEach((dd) => {
    dd.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      const open = dd.classList.contains("open");
      h.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
      dd.classList.toggle("open", !open);
    };
  });
  h.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  $("#menu-toggle", h).onclick = () => document.body.classList.toggle("menu-open");
  const lo = $("#logout-btn", h);
  if (lo) lo.onclick = async () => { await signOut(); toast(t("loggedOut")); location.hash = "#/"; };
}

function closeMobileMenu() { document.body.classList.remove("menu-open"); }
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown")) document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
  if (e.target.closest(".main-nav a")) closeMobileMenu();
});

// ---------------------------------------------------------------- footer
function renderFooter() {
  const year = new Date().getFullYear();
  const social = Object.entries(CONFIG.SOCIAL || {}).filter(([, url]) => url);
  $("#site-footer").innerHTML = `
  <div class="container footer-inner">
    <div class="footer-brand">
      <a href="#/" class="brand"><img class="brand-logo" src="assets/img/logo-icon.png" alt="" width="40" height="40" decoding="async" /><span class="brand-name">${esc(tr(CONFIG.SITE_NAME))}</span></a>
      <p class="muted">${esc(t("footerTagline"))}</p>
    </div>
    <div class="footer-links">
      <a href="#/books">${esc(t("navBooks"))}</a>
      <a href="#/books?price=free">${esc(t("freeBooks"))}</a>
      <a href="#/library">${esc(t("navLibrary"))}</a>
      <a href="#/about">${esc(t("navAbout"))}</a>
      ${CONFIG.CONTACT_EMAIL ? `<a href="mailto:${esc(CONFIG.CONTACT_EMAIL)}">${esc(t("contact"))}</a>` : ""}
    </div>
    <div class="footer-langs">
      ${LANGS.map((l) => `<button class="link-btn ${l === getLang() ? "active" : ""}" data-flang="${l}" lang="${l}">${LANG_NAMES[l]}</button>`).join("")}
      ${social.length ? `<div class="social">${social.map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(k)}</a>`).join("")}</div>` : ""}
    </div>
  </div>
  <div class="container footer-bottom muted small">© ${year} ${esc(tr(CONFIG.AUTHOR_NAME))} — ${esc(t("rightsReserved"))}</div>`;
  document.querySelectorAll("[data-flang]").forEach((b) => (b.onclick = () => setLang(b.dataset.flang)));
}

// ---------------------------------------------------------------- setup screen
function renderSetupScreen() {
  $("#site-header").innerHTML = "";
  $("#site-footer").innerHTML = "";
  $("#main").innerHTML = `
  <div class="container narrow setup-screen">
    <div class="card">
      <img class="setup-logo" src="assets/img/logo-full.png" alt="Maktaba" />
      <h1>${esc(t("setupTitle"))}</h1>
      <p>${esc(t("setupText"))}</p>
      <ol>
        <li>${esc(t("setupStep1"))}</li>
        <li>${esc(t("setupStep2"))}</li>
        <li>${esc(t("setupStep3"))}</li>
      </ol>
      <p class="muted small">assets/js/config.js · supabase/schema.sql · README.md</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- boot
async function boot() {
  if (!isConfigured()) { renderSetupScreen(); return; }

  // Coming back from a password-reset e-mail
  const sp = new URLSearchParams(location.search);
  const isReset = sp.get("reset") === "1";

  await initAuth();

  if (sp.has("code") || isReset || sp.has("error_description")) {
    if (sp.get("error_description")) toast(sp.get("error_description"), "error", 6000);
    history.replaceState(null, "", location.pathname + (isReset ? "#/reset" : location.hash || "#/"));
  }

  renderFooter();
  onLangChange(() => { renderFooter(); router(); });
  onAuthChange((s, userChanged) => {
    if (!userChanged) { renderHeader(); return; }
    if (s.user) syncLocalProgress().catch(() => {});
    const { path } = parseHash();
    if (!path.startsWith("/read/")) router(); else renderHeader();
  });
  window.addEventListener("hashchange", router);
  router();
}

boot().catch((e) => {
  console.error(e);
  $("#main").innerHTML = `<div class="container narrow"><div class="empty-state"><h3>Error</h3><p>${esc(e.message)}</p></div></div>`;
});

export { supabase };
