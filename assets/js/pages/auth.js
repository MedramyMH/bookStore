import { CONFIG } from "../config.js";
import { t, tr } from "../i18n.js";
import { state } from "../store.js";
import { esc, icon, toast, setTitle } from "../ui.js";
import { signIn, signUp, sendPasswordReset, updatePassword, signInWithGoogle, authErrorMessage } from "../api.js";

export default async function render({ root, params, query }) {
  const mode = params.mode;
  const next = query.get("next") || "/library";
  const goNext = () => (location.hash = `#${next.startsWith("/") ? next : "/" + next}`);

  if ((mode === "login" || mode === "register") && state.user) { goNext(); return; }

  const titles = { login: t("loginTitle"), register: t("registerTitle"), forgot: t("forgotTitle"), reset: t("resetTitle") };
  setTitle(titles[mode]);
  const nextQs = query.get("next") ? `?next=${encodeURIComponent(next)}` : "";

  const google = CONFIG.ENABLE_GOOGLE_LOGIN && (mode === "login" || mode === "register")
    ? `<button type="button" class="btn btn-ghost btn-block" id="google-btn">${icon("google")} ${esc(t("continueGoogle"))}</button>
       <div class="divider"><span>${esc(t("or"))}</span></div>` : "";

  const fields = {
    login: `
      <label class="field"><span>${esc(t("email"))}</span><input class="input" type="email" name="email" required autocomplete="email" dir="ltr" /></label>
      <label class="field"><span>${esc(t("password"))}</span><input class="input" type="password" name="password" required autocomplete="current-password" dir="ltr" /></label>
      <div class="row-between"><span></span><a href="#/forgot" class="small">${esc(t("forgotPassword"))}</a></div>`,
    register: `
      <label class="field"><span>${esc(t("fullName"))}</span><input class="input" name="name" required autocomplete="name" dir="auto" /></label>
      <label class="field"><span>${esc(t("email"))}</span><input class="input" type="email" name="email" required autocomplete="email" dir="ltr" /></label>
      <label class="field"><span>${esc(t("password"))}</span><input class="input" type="password" name="password" required minlength="6" autocomplete="new-password" dir="ltr" />
        <small class="muted">${esc(t("passwordHint"))}</small></label>`,
    forgot: `
      <p class="muted">${esc(t("forgotText"))}</p>
      <label class="field"><span>${esc(t("email"))}</span><input class="input" type="email" name="email" required autocomplete="email" dir="ltr" /></label>`,
    reset: `
      <p class="muted">${esc(t("resetText"))}</p>
      <label class="field"><span>${esc(t("newPassword"))}</span><input class="input" type="password" name="password" required minlength="6" autocomplete="new-password" dir="ltr" /></label>
      <label class="field"><span>${esc(t("confirmPassword"))}</span><input class="input" type="password" name="password2" required minlength="6" autocomplete="new-password" dir="ltr" /></label>`,
  };
  const submitLabel = { login: t("login"), register: t("createAccount"), forgot: t("sendResetLink"), reset: t("savePassword") };
  const footer = {
    login: `${esc(t("noAccount"))} <a href="#/register${nextQs}">${esc(t("register"))}</a>`,
    register: `${esc(t("haveAccount"))} <a href="#/login${nextQs}">${esc(t("login"))}</a>`,
    forgot: `<a href="#/login">${esc(t("backToLogin"))}</a>`,
    reset: "",
  };

  root.innerHTML = `
  <div class="auth-page">
    <div class="auth-card card">
      <a href="#/" class="brand center">${icon("book")} <span class="brand-name">${esc(tr(CONFIG.SITE_NAME))}</span></a>
      <h1>${esc(titles[mode])}</h1>
      ${mode === "reset" && !state.user ? `<p class="notice">${esc(t("resetLinkInvalid"))}</p>` : ""}
      ${google}
      <form id="auth-form" novalidate>
        ${fields[mode]}
        <p class="form-error" id="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">${esc(submitLabel[mode])}</button>
      </form>
      <p class="auth-footer">${footer[mode]}</p>
    </div>
  </div>`;

  const form = root.querySelector("#auth-form");
  const errEl = root.querySelector("#form-error");
  const showErr = (m) => { errEl.hidden = !m; errEl.textContent = m || ""; };

  root.querySelector("#google-btn")?.addEventListener("click", () => signInWithGoogle());

  form.onsubmit = async (e) => {
    e.preventDefault();
    showErr("");
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.classList.add("loading");
    try {
      if (mode === "login") {
        await signIn(fd.email.trim(), fd.password);
        toast(t("welcomeBack"), "success");
        goNext();
      } else if (mode === "register") {
        const { needsConfirmation } = await signUp(fd.email.trim(), fd.password, fd.name.trim());
        if (needsConfirmation) {
          form.innerHTML = `<div class="notice success">${icon("mail")} <span>${esc(t("checkEmailConfirm"))}</span></div>`;
        } else { toast(t("accountCreated"), "success"); goNext(); }
      } else if (mode === "forgot") {
        await sendPasswordReset(fd.email.trim());
        form.innerHTML = `<div class="notice success">${icon("mail")} <span>${esc(t("resetEmailSent"))}</span></div>`;
      } else if (mode === "reset") {
        if (fd.password !== fd.password2) throw new Error(t("passwordsDontMatch"));
        await updatePassword(fd.password);
        toast(t("passwordUpdated"), "success");
        location.hash = "#/library";
      }
    } catch (err) {
      showErr(authErrorMessage(err));
    } finally { btn.disabled = false; btn.classList.remove("loading"); }
  };
}
