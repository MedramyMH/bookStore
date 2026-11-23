// pdf.js loader shared by the reader and the admin editor.
// The library URL comes from the import map in index.html; assets (worker, cmaps, fonts)
// are resolved from the same folder so there is a single place to change the version.
import * as pdfjsLib from "pdfjs-dist";

const LIB_URL = import.meta.resolve ? import.meta.resolve("pdfjs-dist") : "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs";
const ROOT = LIB_URL.replace(/(legacy\/)?build\/pdf(\.min)?\.mjs.*$/, "");
const BUILD = LIB_URL.replace(/pdf(\.min)?\.mjs.*$/, "");

pdfjsLib.GlobalWorkerOptions.workerSrc = `${BUILD}pdf.worker.min.mjs`;

export { pdfjsLib };

/** src: URL string, or Uint8Array/ArrayBuffer */
export function openPdf(src, onProgress) {
  const params = {
    cMapUrl: `${ROOT}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ROOT}standard_fonts/`,
    wasmUrl: `${ROOT}wasm/`,
    isEvalSupported: false,
    enableXfa: false,
  };
  if (typeof src === "string") params.url = src; else params.data = src;
  const task = pdfjsLib.getDocument(params);
  if (onProgress) task.onProgress = ({ loaded, total }) => total && onProgress(Math.round((loaded / total) * 100));
  return task.promise;
}

/** Render a page to a canvas element sized for the given CSS width (or scale). */
export async function renderPageToCanvas(page, { width, scale, canvas = document.createElement("canvas") } = {}) {
  const base = page.getViewport({ scale: 1 });
  const cssScale = scale ?? (width ? width / base.width : 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: cssScale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const ctx = canvas.getContext("2d", { alpha: false });
  const task = page.render({ canvas, canvasContext: ctx, viewport });
  await task.promise;
  return { canvas, cssScale, task };
}

/** Extract readable text for a page (used by text-to-speech and search). */
// Rebuilds lines from glyph positions so that:
//  - ligatures (ﬁ, ﬀ) and split glyphs are not separated by fake spaces
//  - Arabic lines stored in visual order are put back into reading order
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_CHARS = /[A-Za-zÀ-ɏ]/g;

export async function getPageText(page) {
  const content = await page.getTextContent();
  const items = content.items.filter((i) => "str" in i && i.str !== "");
  const lines = [];
  for (const it of items) {
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    const g = { str: it.str, x, w: it.width || 0, h, eol: it.hasEOL };
    const last = lines[lines.length - 1];
    if (last && !last.closed && Math.abs(last.y - y) < Math.max(last.h, h) * 0.5) last.items.push(g);
    else lines.push({ y, h, items: [g], closed: false });
    if (it.hasEOL) lines[lines.length - 1].closed = true;
  }
  const text = lines.map((line) => {
    const s = line.items.map((i) => i.str).join("");
    const rtl = (s.match(RTL_CHARS) || []).length > (s.match(LTR_CHARS) || []).length;
    const sorted = [...line.items].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let out = "";
    sorted.forEach((it, i) => {
      if (i) {
        const prev = sorted[i - 1];
        const gap = rtl ? prev.x - (it.x + it.w) : it.x - (prev.x + prev.w);
        if (gap > Math.min(prev.h, it.h) * 0.18 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      }
      out += it.str;
    });
    return out;
  }).join("\n");
  return text.normalize("NFKC") // turns Arabic presentation forms back into normal letters
    .replace(/[ \t]+/g, " ")
    .replace(/-\n(?=\p{Ll})/gu, "") // join hyphenated line breaks
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** First page → JPEG blob, for automatic covers. */
export async function firstPageToJpeg(pdf, width = 700) {
  const page = await pdf.getPage(1);
  const { canvas } = await renderPageToCanvas(page, { width: width / Math.min(window.devicePixelRatio || 1, 3) });
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
}
