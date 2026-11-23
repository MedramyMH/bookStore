// POST { order_id } → { ok: true, book_id }
// Captures the PayPal payment, verifies it belongs to this user and matches the
// book price in the database, then records the purchase (unlocking the book).
import { adminClient, corsHeaders, getUser, json, paypalFetch } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const user = await getUser(req);
    if (!user) return json({ error: "not_authenticated" }, 401);

    const { order_id } = await req.json().catch(() => ({}));
    if (!order_id || !/^[A-Z0-9]+$/i.test(order_id)) return json({ error: "missing_order_id" }, 400);

    // 1. Read the order first to verify ownership before capturing
    const orderRes = await paypalFetch(`/v2/checkout/orders/${order_id}`);
    if (!orderRes.ok) return json({ error: "order_not_found" }, 404);
    const unit = orderRes.data.purchase_units?.[0];
    const [uid, bookId] = String(unit?.custom_id ?? "").split("|");
    if (uid !== user.id || !bookId) return json({ error: "order_mismatch" }, 403);

    const db = adminClient();
    const { data: book } = await db.from("books").select("id, price, currency").eq("id", bookId).single();
    if (!book) return json({ error: "book_not_found" }, 404);

    // 2. Capture (or accept an order that was already captured)
    let order = orderRes.data;
    if (order.status !== "COMPLETED") {
      const cap = await paypalFetch(`/v2/checkout/orders/${order_id}/capture`, {
        method: "POST",
        headers: { "PayPal-Request-Id": `capture-${order_id}` },
      });
      if (!cap.ok) {
        const issue = cap.data?.details?.[0]?.issue;
        if (issue !== "ORDER_ALREADY_CAPTURED") {
          console.error("Capture failed", cap.status, cap.data);
          return json({ error: "capture_failed", issue }, 402);
        }
        order = (await paypalFetch(`/v2/checkout/orders/${order_id}`)).data;
      } else {
        order = cap.data;
      }
    }

    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (order.status !== "COMPLETED" || !capture || capture.status !== "COMPLETED") {
      return json({ error: "payment_not_completed", status: capture?.status ?? order.status }, 402);
    }

    const paid = Number(capture.amount?.value ?? 0);
    const paidCurrency = String(capture.amount?.currency_code ?? "").toUpperCase();
    if (paid + 0.001 < Number(book.price) || paidCurrency !== String(book.currency).toUpperCase()) {
      console.error("Amount mismatch", { paid, paidCurrency, book });
      return json({ error: "amount_mismatch" }, 402);
    }

    // 3. Record the purchase (idempotent)
    const { error } = await db.from("purchases").upsert({
      user_id: user.id,
      book_id: book.id,
      amount: paid,
      currency: paidCurrency,
      provider: "paypal",
      provider_order_id: order_id,
      payer_email: order.payer?.email_address ?? null,
      status: "completed",
    }, { onConflict: "user_id,book_id" });
    if (error) {
      console.error("DB insert failed", error);
      return json({ error: "db_error" }, 500);
    }

    return json({ ok: true, book_id: book.id });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error", message: String((e as Error).message ?? e) }, 500);
  }
});
