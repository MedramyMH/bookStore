import { CONFIG } from "./config.js";
import { MESSAGES } from "./locales.js";

export const LANGS = ["ar", "en", "fr"];
export const LANG_NAMES = { ar: "العربية", en: "English", fr: "Français" };
const LOCALES = { ar: "ar-u-nu-latn", en: "en", fr: "fr" };
const listeners = new Set();

function detect() {
  const saved = localStorage.getItem("lang");
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  return LANGS.includes(nav) ? nav : CONFIG.DEFAULT_LANG;
}

let lang = detect();

export const getLang = () => lang;
export const isRTL = (l = lang) => l === "ar";
export const locale = () => LOCALES[lang];
export const onLangChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function applyLangToDocument() {
  document.documentElement.lang = lang;
  document.documentElement.dir = isRTL() ? "rtl" : "ltr";
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  localStorage.setItem("lang", lang);
  applyLangToDocument();
  listeners.forEach((fn) => fn(lang));
}

/** Translate a key. Variables: t("pageOf", { page: 3, total: 10 }) */
export function t(key, vars) {
  let s = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Pick the right language from an object like { en: "...", ar: "..." } */
export function tr(obj) {
  if (obj == null || typeof obj === "string") return obj ?? "";
  return obj[lang] ?? obj.en ?? Object.values(obj)[0] ?? "";
}

export const fmtNumber = (n) => new Intl.NumberFormat(locale()).format(n ?? 0);
export const fmtDate = (d) =>
  d ? new Intl.DateTimeFormat(locale(), { year: "numeric", month: "short", day: "numeric" }).format(new Date(d)) : "";
export function fmtPrice(amount, currency = CONFIG.DEFAULT_CURRENCY) {
  if (!Number(amount)) return t("free");
  return fmtMoney(amount, currency);
}
export function fmtMoney(amount, currency = CONFIG.DEFAULT_CURRENCY) {
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}
