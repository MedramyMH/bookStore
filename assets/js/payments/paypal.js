// PayPal checkout (JS SDK buttons + Supabase edge functions)
import { CONFIG } from "../config.js";
import { t, fmtPrice } from "../i18n.js";
import { esc, icon, modal, toast, coverHTML } from "../ui.js";
import { callFunction } from "../api.js";

let sdk = null; // { currency, promise }

function loadSDK(currency) {
  if (sdk?.currency === currency) return sdk.promise;
  document.querySelector("script[data-paypal-sdk]")?.remove();
  try { delete window.paypal; } catch { window.paypal = undefined; }
  const promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const params = new URLSearchParams({
      "client-id": CONFIG.PAYPAL_CLIENT_ID,
      currency,
      intent: "capture",
      components: "buttons",
      "enable-funding": "card",
    });
    s.src = `https://www.paypal.com/sdk/js?${params}`;
    s.dataset.paypalSdk = "1";
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK")));
    s.onerror = () => { sdk = null; reject(new Error(t("errPaypalLoad"))); };
    document.head.appendChild(s);
  });
  sdk = { currency, promise };
  return promise;
}

const ERRORS = {
  already_owned: "errAlreadyOwned",
  not_authenticated: "errLoginRequired",
  book_is_free: "errBookIsFree",
  capture_failed: "errPaymentFailed",
  payment_not_completed: "errPaymentFailed",
  amount_mismatch: "errPaymentFailed",
};
const errText = (e) => t(ERRORS[e?.code] || "errPaymentGeneric");

export function openCheckout(book, { onSuccess } = {}) {
  const m = modal({
    title: t("checkout"),
    body: `
      <div class="checkout">
        <div class="checkout-item">
          ${coverHTML(book, "small")}
          <div dir="auto">
            <strong>${esc(book.title)}</strong>
            <div class="muted small">${esc(book.author || "")}</div>
            <div class="checkout-price">${esc(fmtPrice(book.price, book.currency))}</div>
          </div>
        </div>
        <ul class="checkout-perks">
          <li>${icon("check")} ${esc(t("perkLifetime"))}</li>
          <li>${icon("check")} ${esc(t("perkDownload"))}</li>
          <li>${icon("check")} ${esc(t("perkSync"))}</li>
        </ul>
        <div id="pp-status" class="pp-status" hidden></div>
        <div id="pp-buttons" class="pp-buttons"><div class="page-loading small"><span class="spinner"></span></div></div>
        <p class="muted small center">${icon("lock")} ${esc(t("securePayment"))}</p>
      </div>`,
  });

  const box = m.body.querySelector("#pp-buttons");
  const status = m.body.querySelector("#pp-status");
  const setStatus = (msg, type = "info") => {
    status.hidden = !msg; status.className = `pp-status pp-${type}`; status.textContent = msg || "";
  };

  loadSDK((book.currency || CONFIG.DEFAULT_CURRENCY).toUpperCase())
    .then((paypal) => {
      box.innerHTML = "";
      return paypal.Buttons({
        style: { layout: "vertical", shape: "pill", label: "pay", height: 45 },
        createOrder: async () => {
          setStatus("");
          try {
            const { id } = await callFunction("paypal-create-order", { book_id: book.id });
            return id;
          } catch (e) { setStatus(errText(e), "error"); throw e; }
        },
        onApprove: async (data) => {
          setStatus(t("processingPayment"));
          box.style.pointerEvents = "none"; box.style.opacity = ".4";
          try {
            await callFunction("paypal-capture-order", { order_id: data.orderID });
            m.close();
            toast(t("purchaseSuccess"), "success", 5000);
            onSuccess?.();
          } catch (e) {
            box.style.pointerEvents = ""; box.style.opacity = "";
            setStatus(errText(e), "error");
          }
        },
        onCancel: () => setStatus(t("paymentCancelled")),
        onError: (err) => { console.error(err); if (!status.textContent) setStatus(t("errPaymentGeneric"), "error"); },
      }).render(box);
    })
    .catch((e) => { box.innerHTML = ""; setStatus(e.message || t("errPaypalLoad"), "error"); });
}
