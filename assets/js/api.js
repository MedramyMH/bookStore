// Data layer: every Supabase call lives here.
import { supabase } from "./supabase.js";
import { state, isAdmin } from "./store.js";
import { CONFIG } from "./config.js";
import { t } from "./i18n.js";

export const BOOK_COLS =
  "id,slug,title,subtitle,author,description,language,category,tags,isbn,publisher,published_year," +
  "price,currency,cover_url,file_path,sample_url,sample_pages,page_count,file_size,allow_download," +
  "is_published,is_featured,views,downloads,rating_avg,rating_count,published_at,created_at";

const uid = () => state.user?.id ?? null;
const must = ({ data, error, count }) => { if (error) throw error; return count != null ? { data, count } : data; };

// ================================================================ AUTH
export function authErrorMessage(err) {
  const m = String(err?.message || err || "");
  if (/invalid login credentials/i.test(m)) return t("errInvalidLogin");
  if (/already registered|already exists/i.test(m)) return t("errEmailTaken");
  if (/email not confirmed/i.test(m)) return t("errEmailNotConfirmed");
  if (/password should be at least/i.test(m)) return t("errWeakPassword");
  if (/rate limit|too many/i.test(m)) return t("errRateLimit");
  return m || t("errGeneric");
}

const redirectBase = () => `${location.origin}${location.pathname}`;

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password }).then(({ error }) => { if (error) throw error; });

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: fullName }, emailRedirectTo: redirectBase() },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export const signOut = () => supabase.auth.signOut();

export const sendPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: `${redirectBase()}?reset=1` })
    .then(({ error }) => { if (error) throw error; });

export const updatePassword = (password) =>
  supabase.auth.updateUser({ password }).then(({ error }) => { if (error) throw error; });

export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectBase() } });

export const updateProfile = (patch) =>
  supabase.from("profiles").update(patch).eq("id", uid()).then(must);

// ================================================================ BOOKS
export async function listBooks({ q, language, category, price, sort = "newest", from = 0, limit = CONFIG.PAGE_SIZE, featured } = {}) {
  let qb = supabase.from("books").select(BOOK_COLS, { count: "exact" }).eq("is_published", true);
  if (language) qb = qb.eq("language", language);
  if (category) qb = qb.eq("category", category);
  if (price === "free") qb = qb.eq("price", 0);
  if (price === "paid") qb = qb.gt("price", 0);
  if (featured) qb = qb.eq("is_featured", true);
  if (q) {
    const s = q.replace(/[%,()*\\]/g, " ").trim();
    if (s) qb = qb.or(`title.ilike.%${s}%,subtitle.ilike.%${s}%,author.ilike.%${s}%,description.ilike.%${s}%,category.ilike.%${s}%`);
  }
  const orders = {
    newest: ["published_at", false], popular: ["views", false], rating: ["rating_avg", false],
    downloads: ["downloads", false], price_asc: ["price", true], price_desc: ["price", false], title: ["title", true],
  };
  const [col, asc] = orders[sort] ?? orders.newest;
  qb = qb.order(col, { ascending: asc, nullsFirst: false }).order("created_at", { ascending: false });
  return must(await qb.range(from, from + limit - 1));
}

export const getBook = async (slug) =>
  must(await supabase.from("books").select(BOOK_COLS).eq("slug", slug).maybeSingle());

export const getBookById = async (id) =>
  must(await supabase.from("books").select(BOOK_COLS).eq("id", id).maybeSingle());

export async function getBooksByIds(ids) {
  if (!ids.length) return [];
  return must(await supabase.from("books").select(BOOK_COLS).in("id", ids));
}

export async function relatedBooks(book, limit = 6) {
  let qb = supabase.from("books").select(BOOK_COLS).eq("is_published", true).neq("id", book.id).limit(limit);
  qb = book.category ? qb.or(`category.eq.${JSON.stringify(book.category)},language.eq.${book.language}`) : qb.eq("language", book.language);
  return must(await qb.order("views", { ascending: false }));
}

export async function getCategories() {
  const rows = must(await supabase.from("books").select("category").eq("is_published", true).neq("category", ""));
  return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function bumpStat(bookId, field) {
  const key = `stat:${field}:${bookId}`;
  if (field === "views" && sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  supabase.rpc("increment_book_stat", { p_book_id: bookId, p_field: field }).then(() => {}, () => {});
}

// ================================================================ ACCESS & FILES
export async function getOwnedIds() {
  if (!uid()) return new Set();
  const rows = must(await supabase.from("purchases").select("book_id").eq("user_id", uid()).eq("status", "completed"));
  return new Set(rows.map((r) => r.book_id));
}

export async function hasAccess(book) {
  if (!Number(book.price)) return true;
  if (isAdmin()) return true;
  if (!uid()) return false;
  const { data } = await supabase.from("purchases").select("id")
    .eq("user_id", uid()).eq("book_id", book.id).eq("status", "completed").maybeSingle();
  return !!data;
}

export async function getBookFileUrl(book) {
  if (!book.file_path) throw new Error(t("errNoFile"));
  const { data, error } = await supabase.storage.from("books").createSignedUrl(book.file_path, 60 * 60 * 3);
  if (error) throw error;
  return data.signedUrl;
}

export function safeFileName(title) {
  return (String(title).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || "book") + ".pdf";
}

/** Downloads the full PDF (only works when the user has access). */
export async function downloadBook(book, onProgress) {
  const url = await getBookFileUrl(book);
  const res = await fetch(url);
  if (!res.ok) throw new Error(t("errDownload"));
  const total = Number(res.headers.get("content-length")) || book.file_size || 0;
  const reader = res.body?.getReader?.();
  let blob;
  if (reader && onProgress) {
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(Math.round((got / total) * 100));
    }
    blob = new Blob(chunks, { type: "application/pdf" });
  } else {
    blob = await res.blob();
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(book.title);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  bumpStat(book.id, "downloads");
}

// ================================================================ READING PROGRESS
// Guests: localStorage only. Signed-in readers: localStorage + Supabase (newest wins).
const LP_KEY = "reading-progress";
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LP_KEY)) || {}; } catch { return {}; } };
const writeLocal = (obj) => { try { localStorage.setItem(LP_KEY, JSON.stringify(obj)); } catch {} };

export const getLocalProgress = (bookId) => readLocal()[bookId] ?? null;

export async function getProgress(bookId) {
  const local = getLocalProgress(bookId);
  if (!uid()) return local;
  const { data } = await supabase.from("reading_progress").select("*").eq("user_id", uid()).eq("book_id", bookId).maybeSingle();
  if (!data) return local;
  if (!local) return data;
  return new Date(local.updated_at) > new Date(data.updated_at) ? local : data;
}

export async function saveProgress(bookId, page, totalPages, extra = {}) {
  const percent = totalPages ? Math.min(100, (page / totalPages) * 100) : 0;
  const row = { page, total_pages: totalPages, percent: Number(percent.toFixed(2)), finished: page >= totalPages, updated_at: new Date().toISOString(), ...extra };
  const all = readLocal(); all[bookId] = row; writeLocal(all);
  if (uid()) {
    await supabase.from("reading_progress").upsert({ user_id: uid(), book_id: bookId, ...row });
  }
  return row;
}

export async function listMyProgress() {
  if (uid()) {
    const rows = must(await supabase.from("reading_progress").select(`*, book:books(${BOOK_COLS})`)
      .eq("user_id", uid()).order("updated_at", { ascending: false }));
    return rows.filter((r) => r.book);
  }
  const local = readLocal();
  const ids = Object.keys(local);
  const books = await getBooksByIds(ids);
  return books.map((book) => ({ ...local[book.id], book_id: book.id, book }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

/** After sign-in, push progress made as a guest to the account. */
export async function syncLocalProgress() {
  if (!uid()) return;
  const local = readLocal();
  const ids = Object.keys(local);
  if (!ids.length) return;
  const { data: remote } = await supabase.from("reading_progress").select("book_id,updated_at").eq("user_id", uid());
  const map = new Map((remote || []).map((r) => [r.book_id, r.updated_at]));
  const rows = ids.filter((id) => !map.has(id) || new Date(local[id].updated_at) > new Date(map.get(id)))
    .map((id) => ({ user_id: uid(), book_id: id, ...local[id] }));
  if (rows.length) await supabase.from("reading_progress").upsert(rows);
}

// ================================================================ BOOKMARKS
const BM_KEY = (id) => `bookmarks:${id}`;
export async function listBookmarks(bookId) {
  if (!uid()) { try { return JSON.parse(localStorage.getItem(BM_KEY(bookId))) || []; } catch { return []; } }
  return must(await supabase.from("bookmarks").select("*").eq("user_id", uid()).eq("book_id", bookId).order("page"));
}
export async function addBookmark(bookId, page, note = "") {
  if (!uid()) {
    const list = await listBookmarks(bookId);
    const bm = { id: crypto.randomUUID(), book_id: bookId, page, note, created_at: new Date().toISOString() };
    list.push(bm); list.sort((a, b) => a.page - b.page);
    localStorage.setItem(BM_KEY(bookId), JSON.stringify(list));
    return bm;
  }
  return must(await supabase.from("bookmarks").insert({ user_id: uid(), book_id: bookId, page, note }).select().single());
}
export async function updateBookmark(bookId, id, note) {
  if (!uid()) {
    const list = (await listBookmarks(bookId)).map((b) => (b.id === id ? { ...b, note } : b));
    localStorage.setItem(BM_KEY(bookId), JSON.stringify(list));
    return;
  }
  must(await supabase.from("bookmarks").update({ note }).eq("id", id));
}
export async function removeBookmark(bookId, id) {
  if (!uid()) {
    const list = (await listBookmarks(bookId)).filter((b) => b.id !== id);
    localStorage.setItem(BM_KEY(bookId), JSON.stringify(list));
    return;
  }
  must(await supabase.from("bookmarks").delete().eq("id", id));
}

// ================================================================ WISHLIST
export async function getWishlistIds() {
  if (!uid()) return new Set();
  const rows = must(await supabase.from("wishlist").select("book_id").eq("user_id", uid()));
  return new Set(rows.map((r) => r.book_id));
}
export async function listWishlist() {
  if (!uid()) return [];
  const rows = must(await supabase.from("wishlist").select(`created_at, book:books(${BOOK_COLS})`)
    .eq("user_id", uid()).order("created_at", { ascending: false }));
  return rows.map((r) => r.book).filter(Boolean);
}
export async function toggleWishlist(bookId, on) {
  if (on) must(await supabase.from("wishlist").upsert({ user_id: uid(), book_id: bookId }));
  else must(await supabase.from("wishlist").delete().eq("user_id", uid()).eq("book_id", bookId));
}

// ================================================================ REVIEWS
export const listReviews = async (bookId) =>
  must(await supabase.from("reviews").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).limit(100));

export const saveReview = async (bookId, rating, comment) =>
  must(await supabase.from("reviews").upsert({ user_id: uid(), book_id: bookId, rating, comment }, { onConflict: "user_id,book_id" }));

export const deleteReview = async (id) => must(await supabase.from("reviews").delete().eq("id", id));

// ================================================================ PURCHASES (reader side)
export async function listMyPurchases() {
  if (!uid()) return [];
  return must(await supabase.from("purchases").select(`*, book:books(${BOOK_COLS})`)
    .eq("user_id", uid()).order("created_at", { ascending: false }));
}

/** Calls an edge function and turns its JSON error into a readable Error */
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = error.message;
    try { const j = await error.context?.json?.(); code = j?.error || code; } catch {}
    const e = new Error(code); e.code = code; throw e;
  }
  return data;
}

// ================================================================ ADMIN
export const adminListBooks = async () =>
  must(await supabase.from("books").select(BOOK_COLS).order("created_at", { ascending: false }));

export const adminSaveBook = async (row) =>
  must(await supabase.from("books").upsert(row).select(BOOK_COLS).single());

export const adminUpdateBook = async (id, patch) =>
  must(await supabase.from("books").update(patch).eq("id", id));

export async function adminUpload(bucket, path, file, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true, contentType: contentType || file.type || undefined, cacheControl: "3600",
  });
  if (error) throw error;
  if (bucket === "books") return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function adminDownloadBookBytes(path) {
  const { data, error } = await supabase.storage.from("books").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

export async function adminDeleteBook(book) {
  for (const bucket of ["books", "covers", "samples"]) {
    const { data } = await supabase.storage.from(bucket).list(book.id, { limit: 1000 });
    if (data?.length) await supabase.storage.from(bucket).remove(data.map((f) => `${book.id}/${f.name}`));
  }
  must(await supabase.from("books").delete().eq("id", book.id));
}

export async function adminCleanOldFiles(bucket, bookId, keepPath) {
  const { data } = await supabase.storage.from(bucket).list(bookId, { limit: 1000 });
  const old = (data || []).map((f) => `${bookId}/${f.name}`).filter((p) => p !== keepPath);
  if (old.length) await supabase.storage.from(bucket).remove(old);
}

export async function adminListPurchases() {
  const rows = must(await supabase.from("purchases").select("*, book:books(title,slug,currency)").order("created_at", { ascending: false }).limit(1000));
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profiles = ids.length ? must(await supabase.from("profiles").select("id,email,full_name").in("id", ids)) : [];
  const map = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: map.get(r.user_id) }));
}

export const adminListReaders = async () =>
  must(await supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(1000));

export const adminSetRole = async (id, role) => must(await supabase.from("profiles").update({ role }).eq("id", id));

export async function adminGrantBook(email, bookId) {
  const { data, error } = await supabase.rpc("admin_grant_book", { p_email: email, p_book_id: bookId });
  if (error) throw error;
  return data;
}

export async function adminRevokePurchase(id) {
  must(await supabase.from("purchases").update({ status: "refunded" }).eq("id", id));
}
