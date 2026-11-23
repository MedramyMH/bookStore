// PayPal webhook (optional but recommended).
// Handles refunds/reversals so refunded readers lose access automatically.
// In PayPal Developer Dashboard → your app → Webhooks, add:
//   URL:    https://<project-ref>.supabase.co/functions/v1/paypal-webhook
//   Events: PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED, PAYMENT.CAPTURE.COMPLETED
// Then set the secret:  supabase secrets set PAYPAL_WEBHOOK_ID=<the webhook id>
// Deploy with --no-verify-jwt (PayPal does not send a Supabase JWT).
import { adminClient, json, paypalFetch } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }

  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  if (!webhookId) return json({ error: "webhook_not_configured" }, 500);

  // Verify the signature with PayPal
  const verify = await paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: req.headers.get("paypal-auth-algo"),
      cert_url: req.headers.get("paypal-cert-url"),
      transmission_id: req.headers.get("paypal-transmission-id"),
      transmission_sig: req.headers.get("paypal-transmission-sig"),
      transmission_time: req.headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!verify.ok || verify.data?.verification_status !== "SUCCESS") {
    return json({ error: "invalid_signature" }, 401);
  }

  const db = adminClient();
  const type = event.event_type as string;
  const resource = event.resource ?? {};

  // The capture's links contain "up" → the order. supplementary_data has the order id.
  const orderId: string | undefined =
    resource?.supplementary_data?.related_ids?.order_id ??
    resource?.links?.find((l: any) => l.rel === "up")?.href?.split("/").pop();

  if ((type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") && orderId) {
    await db.from("purchases").update({ status: "refunded" }).eq("provider_order_id", orderId);
  }

  if (type === "PAYMENT.CAPTURE.COMPLETED" && orderId && resource.custom_id) {
    // Safety net: if the browser closed before /capture finished, still unlock the book.
    const [userId, bookId] = String(resource.custom_id).split("|");
    if (userId && bookId) {
      await db.from("purchases").upsert({
        user_id: userId,
        book_id: bookId,
        amount: Number(resource.amount?.value ?? 0),
        currency: resource.amount?.currency_code ?? "USD",
        provider: "paypal",
        provider_order_id: orderId,
        status: "completed",
      }, { onConflict: "user_id,book_id" });
    }
  }

  return json({ received: true });
});
