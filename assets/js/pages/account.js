import { t, fmtDate, fmtPrice, setLang, LANGS, LANG_NAMES } from "../i18n.js";
import { state, refreshProfile } from "../store.js";
import { esc, icon, toast, setTitle } from "../ui.js";
import { updateProfile, updatePassword, listMyPurchases, signOut, authErrorMessage } from "../api.js";

export default async function render({ root, isCurrent }) {
  setTitle(t("account"));
  const p = state.profile || {};
  root.innerHTML = `
  <div class="container narrow">
    <div class="page-head"><h1>${esc(t("account"))}</h1></div>

    <section class="card stack">
      <h2>${esc(t("profile"))}</h2>
      <form id="profile-form" class="stack">
        <label class="field"><span>${esc(t("fullName"))}</span><input class="input" name="full_name" value="${esc(p.full_name || "")}" dir="auto" /></label>
        <label class="field"><span>${esc(t("email"))}</span><input class="input" value="${esc(state.user.email || "")}" disabled dir="ltr" /></label>
        <label class="field"><span>${esc(t("preferredLanguage"))}</span>
          <select class="input" name="preferred_lang">${LANGS.map((l) => `<option value="${l}" ${p.preferred_lang === l ? "selected" : ""}>${LANG_NAMES[l]}</option>`).join("")}</select></label>
        <div><button class="btn btn-primary">${esc(t("save"))}</button></div>
      </form>
    </section>

    <section class="card stack">
      <h2>${esc(t("changePassword"))}</h2>
      <form id="pw-form" class="stack">
        <label class="field"><span>${esc(t("newPassword"))}</span><input class="input" type="password" name="password" minlength="6" required autocomplete="new-password" dir="ltr" /></label>
        <div><button class="btn btn-ghost">${esc(t("savePassword"))}</button></div>
      </form>
    </section>

    <section class="card stack">
      <h2>${esc(t("purchaseHistory"))}</h2>
      <div id="purchases"><div class="page-loading small"><span class="spinner"></span></div></div>
    </section>

    <button class="btn btn-danger-ghost" id="signout">${icon("logout")} ${esc(t("logout"))}</button>
  </div>`;

  root.querySelector("#profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await updateProfile({ full_name: fd.full_name.trim(), preferred_lang: fd.preferred_lang });
      await refreshProfile();
      toast(t("saved"), "success");
      setLang(fd.preferred_lang);
    } catch (err) { toast(err.message, "error"); }
  };
  root.querySelector("#pw-form").onsubmit = async (e) => {
    e.preventDefault();
    try { await updatePassword(e.target.password.value); e.target.reset(); toast(t("passwordUpdated"), "success"); }
    catch (err) { toast(authErrorMessage(err), "error"); }
  };
  root.querySelector("#signout").onclick = async () => { await signOut(); location.hash = "#/"; };

  const list = await listMyPurchases().catch(() => []);
  if (!isCurrent()) return;
  root.querySelector("#purchases").innerHTML = list.length ? `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${esc(t("book"))}</th><th>${esc(t("date"))}</th><th>${esc(t("amount"))}</th><th>${esc(t("status"))}</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td>${r.book ? `<a href="#/book/${encodeURIComponent(r.book.slug)}" dir="auto">${esc(r.book.title)}</a>` : "—"}</td>
        <td>${esc(fmtDate(r.created_at))}</td>
        <td>${r.provider === "gift" ? esc(t("gift")) : esc(fmtPrice(r.amount, r.currency))}</td>
        <td><span class="badge ${r.status === "completed" ? "badge-free" : "badge-warn"}">${esc(t("status_" + r.status))}</span></td>
      </tr>`).join("")}</tbody></table></div>`
    : `<p class="muted">${esc(t("noPurchases"))}</p>`;
}
