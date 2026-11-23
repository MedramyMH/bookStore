// POST { book_id } → { id: <PayPal order id> }
// The price is ALWAYS read from the database, never trusted from the browser.
import { adminClient, corsHeaders, getUser, json, paypalFetch } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const user = await getUser(req);
    if (!user) return json({ error: "not_authenticated" }, 401);

    const { book_id } = await req.json().catch(() => ({}));
    if (!book_id) return json({ error: "missing_book_id" }, 400);

    const db = adminClient();
    const { data: book, error } = await db
      .from("books")
      .select("id, title, price, currency, is_published")
      .eq("id", book_id)
      .single();
    if (error || !book || !book.is_published) return json({ error: "book_not_found" }, 404);
    if (Number(book.price) <= 0) return json({ error: "book_is_free" }, 400);

    const { data: owned } = await db
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("book_id", book.id)
      .eq("status", "completed")
      .maybeSingle();
    if (owned) return json({ error: "already_owned" }, 409);

    const value = Number(book.price).toFixed(2);
    const currency = (book.currency || "USD").toUpperCase();

    const { ok, status, data } = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: book.id,
          custom_id: `${user.id}|${book.id}`,
          description: String(book.title).slice(0, 127),
          amount: {
            currency_code: currency,
            value,
            // PayPal requires item_total whenever items[] is sent
            breakdown: { item_total: { currency_code: currency, value } },
          },
          items: [{
            name: String(book.title).slice(0, 127),
            quantity: "1",
            category: "DIGITAL_GOODS",
            unit_amount: { currency_code: currency, value },
          }],
        }],
        application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
      }),
    });

    if (!ok) {
      console.error("PayPal create order failed", status, data);
      return json({ error: "paypal_error", details: data?.details ?? data }, 502);
    }
    return json({ id: data.id });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error", message: String((e as Error).message ?? e) }, 500);
  }
});
