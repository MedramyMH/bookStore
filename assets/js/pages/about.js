import { CONFIG } from "../config.js";
import { t, tr, fmtNumber } from "../i18n.js";
import { esc, icon, setTitle, bookCard } from "../ui.js";
import { listBooks } from "../api.js";

export default async function render({ root, isCurrent }) {
  setTitle(t("navAbout"));
  const name = tr(CONFIG.AUTHOR_NAME);
  const social = Object.entries(CONFIG.SOCIAL || {}).filter(([, u]) => u);
  root.innerHTML = `
  <div class="container narrow about-page">
    <div class="about-head">
      ${CONFIG.AUTHOR_PHOTO ? `<img class="author-photo" src="${esc(CONFIG.AUTHOR_PHOTO)}" alt="${esc(name)}" />`
        : `<div class="author-photo placeholder">${esc(name[0] || "?")}</div>`}
      <div>
        <p class="eyebrow">${esc(t("theAuthor"))}</p>
        <h1>${esc(name)}</h1>
        <p class="lead">${esc(tr(CONFIG.AUTHOR_BIO))}</p>
        <div class="row gap">
          ${CONFIG.CONTACT_EMAIL ? `<a class="btn btn-primary" href="mailto:${esc(CONFIG.CONTACT_EMAIL)}">${icon("mail")} ${esc(t("contact"))}</a>` : ""}
          ${social.map(([k, u]) => `<a class="btn btn-ghost" href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join("")}
        </div>
      </div>
    </div>
    <div class="stats-row" id="about-stats"></div>
    <section class="book-section"><h2>${esc(t("allBooks"))}</h2><div id="about-books"></div></section>
  </div>`;

  const none = { data: [], count: 0 };
  const [{ data, count }, free, ...perLang] = await Promise.all([
    listBooks({ sort: "newest", limit: 12 }).catch(() => none),
    listBooks({ price: "free", limit: 1 }).catch(() => none),
    ...["ar", "en", "fr"].map((language) => listBooks({ language, limit: 1 }).catch(() => none)),
  ]);
  if (!isCurrent()) return;
  const langs = perLang.filter((r) => r.count > 0).length;
  root.querySelector("#about-stats").innerHTML = `
    <div class="stat"><strong>${fmtNumber(count || 0)}</strong><span>${esc(t("statBooks"))}</span></div>
    <div class="stat"><strong>${fmtNumber(langs)}</strong><span>${esc(t("statLanguages"))}</span></div>
    <div class="stat"><strong>${fmtNumber(free.count || 0)}</strong><span>${esc(t("freeBooks"))}</span></div>`;
  root.querySelector("#about-books").innerHTML = `<div class="book-grid">${data.map((b) => bookCard(b)).join("")}</div>`;
}
