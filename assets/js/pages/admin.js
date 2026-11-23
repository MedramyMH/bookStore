import { t, fmtNumber, fmtDate, fmtPrice, fmtMoney, LANG_NAMES } from "../i18n.js";
import { state } from "../store.js";
import { esc, icon, toast, setTitle, confirmDialog, coverHTML, emptyState, debounce } from "../ui.js";
import {
  adminListBooks, adminListPurchases, adminListReaders, adminUpdateBook, adminDeleteBook,
  adminGrantBook, adminSetRole, adminRevokePurchase,
} from "../api.js";

export default async function render({ root, query, isCurrent }) {
  setTitle(t("navAdmin"));
  const tab = query.get("tab") || "dashboard";
  const tabs = [
    ["dashboard", t("dashboard"), "chart"],
    ["books", t("navBooks"), "book"],
    ["sales", t("sales"), "cart"],
    ["readers", t("readers"), "users"],
  ];
  root.innerHTML = `
  <div class="container admin">
    <div class="page-head row-between">
      <h1>${esc(t("navAdmin"))}</h1>
      <a class="btn btn-primary" href="#/admin/book/new">${icon("plus")} ${esc(t("addBook"))}</a>
    </div>
    <div class="tabs">${tabs.map(([k, l, ic]) => `<a class="tab ${k === tab ? "active" : ""}" href="#/admin?tab=${k}">${icon(ic)} ${esc(l)}</a>`).join("")}</div>
    <div id="admin-body"><div class="page-loading"><span class="spinner"></span></div></div>
  </div>`;
  const body = root.querySelector("#admin-body");

  const [books, sales, readers] = await Promise.all([
    adminListBooks(), adminListPurchases().catch(() => []), adminListReaders().catch(() => []),
  ]);
  if (!isCurrent()) return;

  if (tab === "dashboard") renderDashboard(body, books, sales, readers);
  if (tab === "books") renderBooks(body, books);
  if (tab === "sales") renderSales(body, sales);
  if (tab === "readers") renderReaders(body, readers, books);
}

const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// ------------------------------------------------------------ dashboard
function renderDashboard(body, books, sales, readers) {
  const done = sales.filter((s) => s.status === "completed" && s.provider === "paypal");
  const revenue = {};
  done.forEach((s) => (revenue[s.currency] = (revenue[s.currency] || 0) + Number(s.amount)));
  const revenueText = Object.keys(revenue).length
    ? Object.entries(revenue).map(([c, v]) => fmtMoney(v, c)).join(" + ") : fmtMoney(0, "USD");
  const views = books.reduce((a, b) => a + (b.views || 0), 0);
  const downloads = books.reduce((a, b) => a + (b.downloads || 0), 0);

  // last 30 days sales chart
  const days = [...Array(30)].map((_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (29 - i)); return d;
  });
  const perDay = days.map((d) => done.filter((s) => { const x = new Date(s.created_at); x.setHours(0, 0, 0, 0); return +x === +d; }).length);
  const max = Math.max(1, ...perDay);

  const top = [...books].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);

  body.innerHTML = `
  <div class="stat-cards">
    ${statCard("book", t("statBooks"), fmtNumber(books.length), t("publishedCount", { n: fmtNumber(books.filter((b) => b.is_published).length) }))}
    ${statCard("cart", t("revenue"), revenueText, t("salesCount", { n: fmtNumber(done.length) }))}
    ${statCard("users", t("readers"), fmtNumber(readers.length))}
    ${statCard("eye", t("views"), fmtNumber(views))}
    ${statCard("download", t("downloads"), fmtNumber(downloads))}
  </div>
  <div class="admin-grid">
    <section class="card">
      <h3>${esc(t("salesLast30"))}</h3>
      <div class="bar-chart" role="img" aria-label="${esc(t("salesLast30"))}">
        ${perDay.map((n, i) => `<div class="bar" style="--h:${(n / max) * 100}%" title="${esc(fmtDate(days[i]))}: ${n}"><span></span></div>`).join("")}
      </div>
    </section>
    <section class="card">
      <h3>${esc(t("topBooks"))}</h3>
      ${top.length ? `<ol class="top-list">${top.map((b) => `<li><a href="#/book/${encodeURIComponent(b.slug)}" dir="auto">${esc(b.title)}</a>
        <span class="muted small">${icon("eye")} ${fmtNumber(b.views)} · ${icon("download")} ${fmtNumber(b.downloads)}</span></li>`).join("")}</ol>` : `<p class="muted">—</p>`}
    </section>
    <section class="card span-2">
      <h3>${esc(t("recentSales"))}</h3>
      ${salesTable(sales.slice(0, 8), false)}
    </section>
  </div>`;
}

const statCard = (ic, label, value, sub = "") =>
  `<div class="stat-card"><span class="stat-icon">${icon(ic)}</span><div><span class="muted small">${esc(label)}</span>
   <strong>${esc(value)}</strong>${sub ? `<span class="muted small">${esc(sub)}</span>` : ""}</div></div>`;

// ------------------------------------------------------------ books
function renderBooks(body, books) {
  body.innerHTML = `
  <div class="toolbar"><div class="input-icon">${icon("search")}<input class="input" id="book-filter" placeholder="${esc(t("search"))}" /></div></div>
  ${books.length ? `<div class="table-wrap"><table class="table admin-books">
    <thead><tr><th></th><th>${esc(t("title"))}</th><th>${esc(t("language"))}</th><th>${esc(t("price"))}</th>
      <th>${esc(t("status"))}</th><th>${esc(t("views"))}</th><th></th></tr></thead>
    <tbody>${books.map((b) => `
      <tr data-row="${b.id}" data-search="${esc((b.title + " " + b.author + " " + (b.category || "")).toLowerCase())}">
        <td class="td-cover">${coverHTML(b, "tiny")}</td>
        <td><a href="#/book/${encodeURIComponent(b.slug)}" dir="auto"><strong>${esc(b.title)}</strong></a>
          <div class="muted small" dir="auto">${esc(b.author)}${b.category ? " · " + esc(b.category) : ""}</div></td>
        <td>${esc(LANG_NAMES[b.language])}</td>
        <td>${esc(fmtPrice(b.price, b.currency))}</td>
        <td>
          <label class="switch" title="${esc(t("published"))}"><input type="checkbox" data-toggle="is_published" data-id="${b.id}" ${b.is_published ? "checked" : ""}/><span></span> ${esc(t("published"))}</label>
          <label class="switch" title="${esc(t("featured"))}"><input type="checkbox" data-toggle="is_featured" data-id="${b.id}" ${b.is_featured ? "checked" : ""}/><span></span> ${esc(t("featured"))}</label>
        </td>
        <td class="muted small">${icon("eye")} ${fmtNumber(b.views)}<br/>${icon("download")} ${fmtNumber(b.downloads)}</td>
        <td class="td-actions">
          <a class="icon-btn" href="#/admin/book/${b.id}" title="${esc(t("edit"))}">${icon("edit")}</a>
          <button class="icon-btn danger" data-del="${b.id}" title="${esc(t("delete"))}">${icon("trash")}</button>
        </td>
      </tr>`).join("")}</tbody></table></div>`
    : emptyState(t("noBooksYet"), t("addFirstBook"), `<a class="btn btn-primary" href="#/admin/book/new">${icon("plus")} ${esc(t("addBook"))}</a>`)}`;

  body.querySelector("#book-filter")?.addEventListener("input", debounce((e) => {
    const q = e.target.value.toLowerCase().trim();
    body.querySelectorAll("[data-row]").forEach((r) => (r.hidden = q && !r.dataset.search.includes(q)));
  }, 150));

  body.querySelectorAll("[data-toggle]").forEach((cb) => (cb.onchange = async () => {
    try {
      await adminUpdateBook(cb.dataset.id, { [cb.dataset.toggle]: cb.checked });
      toast(t("saved"), "success");
    } catch (e) { cb.checked = !cb.checked; toast(e.message, "error"); }
  }));

  body.querySelectorAll("[data-del]").forEach((btn) => (btn.onclick = async () => {
    const b = books.find((x) => x.id === btn.dataset.del);
    if (!(await confirmDialog(t("deleteBookConfirm", { title: b.title }), { danger: true, okText: t("delete") }))) return;
    btn.disabled = true;
    try { await adminDeleteBook(b); toast(t("deleted"), "success"); rerender(); }
    catch (e) { btn.disabled = false; toast(e.message, "error"); }
  }));
}

// ------------------------------------------------------------ sales
function salesTable(sales, withActions = true) {
  if (!sales.length) return `<p class="muted">${esc(t("noSales"))}</p>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>${esc(t("date"))}</th><th>${esc(t("book"))}</th><th>${esc(t("reader"))}</th><th>${esc(t("amount"))}</th><th>${esc(t("method"))}</th><th>${esc(t("status"))}</th>${withActions ? "<th></th>" : ""}</tr></thead>
    <tbody>${sales.map((s) => `<tr>
      <td class="nowrap">${esc(fmtDate(s.created_at))}</td>
      <td dir="auto">${s.book ? `<a href="#/book/${encodeURIComponent(s.book.slug)}">${esc(s.book.title)}</a>` : "—"}</td>
      <td><div>${esc(s.profile?.full_name || "")}</div><div class="muted small" dir="ltr">${esc(s.profile?.email || s.payer_email || "")}</div></td>
      <td>${esc(fmtPrice(s.amount, s.currency))}</td>
      <td>${esc(s.provider)}${s.provider_order_id ? `<div class="muted tiny" dir="ltr">${esc(s.provider_order_id)}</div>` : ""}</td>
      <td><span class="badge ${s.status === "completed" ? "badge-free" : "badge-warn"}">${esc(t("status_" + s.status))}</span></td>
      ${withActions ? `<td>${s.status === "completed" ? `<button class="link-btn danger small" data-revoke="${s.id}">${esc(t("revokeAccess"))}</button>` : ""}</td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
}

function renderSales(body, sales) {
  body.innerHTML = `<div class="toolbar"><span class="muted">${esc(t("salesCount", { n: fmtNumber(sales.length) }))}</span>
    <button class="btn btn-ghost btn-sm" id="csv">${icon("download")} ${esc(t("exportCsv"))}</button></div>${salesTable(sales)}`;
  body.querySelector("#csv").onclick = () => {
    const rows = [["date", "book", "name", "email", "amount", "currency", "provider", "order_id", "status"],
      ...sales.map((s) => [s.created_at, s.book?.title, s.profile?.full_name, s.profile?.email || s.payer_email, s.amount, s.currency, s.provider, s.provider_order_id, s.status])];
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  body.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t("revokeConfirm"), { danger: true, okText: t("revokeAccess") }))) return;
    try { await adminRevokePurchase(b.dataset.revoke); toast(t("saved"), "success"); rerender(); }
    catch (e) { toast(e.message, "error"); }
  }));
}

// ------------------------------------------------------------ readers
function renderReaders(body, readers, books) {
  const paidBooks = books.filter((b) => Number(b.price) > 0);
  body.innerHTML = `
  <section class="card stack">
    <h3>${icon("gift")} ${esc(t("grantBook"))}</h3>
    <p class="muted small">${esc(t("grantBookText"))}</p>
    <form id="grant-form" class="grant-form">
      <input class="input" type="email" name="email" placeholder="${esc(t("email"))}" required dir="ltr" />
      <select class="input" name="book" required>${paidBooks.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join("")}</select>
      <button class="btn btn-primary">${esc(t("grant"))}</button>
    </form>
  </section>
  <div class="toolbar"><span class="muted">${esc(t("readersCount", { n: fmtNumber(readers.length) }))}</span></div>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>${esc(t("fullName"))}</th><th>${esc(t("email"))}</th><th>${esc(t("joined"))}</th><th>${esc(t("role"))}</th></tr></thead>
    <tbody>${readers.map((r) => `<tr>
      <td dir="auto">${esc(r.full_name || "—")}</td><td dir="ltr">${esc(r.email || "")}</td><td>${esc(fmtDate(r.created_at))}</td>
      <td>${r.id === state.user.id ? `<span class="badge">${esc(t("role_" + r.role))}</span>`
        : `<select class="input input-sm" data-role="${r.id}"><option value="reader" ${r.role === "reader" ? "selected" : ""}>${esc(t("role_reader"))}</option>
           <option value="admin" ${r.role === "admin" ? "selected" : ""}>${esc(t("role_admin"))}</option></select>`}</td>
    </tr>`).join("")}</tbody></table></div>`;

  body.querySelector("#grant-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await adminGrantBook(fd.get("email").trim(), fd.get("book"));
      if (res === "user_not_found") toast(t("userNotFound"), "error");
      else { toast(t("bookGranted"), "success"); e.target.reset(); }
    } catch (err) { toast(err.message, "error"); }
  };
  body.querySelectorAll("[data-role]").forEach((sel) => (sel.onchange = async () => {
    if (!(await confirmDialog(t("changeRoleConfirm")))) { rerender(); return; }
    try { await adminSetRole(sel.dataset.role, sel.value); toast(t("saved"), "success"); }
    catch (e) { toast(e.message, "error"); }
  }));
}

