# Maktaba — your personal book website

A complete website to publish your books in **Arabic, English and French**: readers can read online, download as PDF, listen with an auto‑reader, and pick up where they stopped. Books can be **free or for sale (PayPal)**. Built with **Supabase** and plain HTML/JS, so there is **no build step**: upload the folder to any static host.

---

## Features

**For readers**
- Kindle-style book pages: 3D cover, description, ratings and reviews, related books, share and wishlist
- **Online reader** (pdf.js): page-turn animation, keyboard arrows and swipe (right-to-left for Arabic books), two-page spread, fit-page or fit-width, zoom, **light / sepia / night** themes, brightness, full screen
- **Saves where you stopped**: every page turn is saved (on the device for guests, synced to the account for signed-in readers), with a "Continue (page X)" button
- **Auto-reader (text-to-speech)**: reads page after page and turns pages automatically, with voice and speed choice, next/previous sentence, lock-screen controls, and keeps the screen awake
- Table of contents (or page thumbnails), **search inside the book** with highlights, **bookmarks with notes**
- **Download PDF** (you can switch this off per book)
- **Free sample** of paid books (generated automatically from the first N pages)
- My library: Reading · Purchased · Wishlist · Finished
- Accounts: sign up, sign in, forgot/reset password, optional Google sign-in, purchase history
- 3 languages with full **RTL** layout for Arabic, plus light/dark site theme, mobile-friendly

**For you (admin dashboard)**
- Upload a PDF by drag & drop. Page count is detected, the **cover is made from page 1** automatically (or you upload one), and the **free sample is generated** for paid books
- Free or paid, price and currency, featured, published/draft, allow download, categories, tags, ISBN…
- Sales dashboard: revenue, 30-day chart, most viewed books, recent sales, **CSV export**
- Readers list, make someone admin, **give a book for free** (gifts, reviewers, payments outside PayPal), revoke access

**Security**
- Full PDFs live in a **private** bucket. Supabase only serves them to readers who have access (free book, purchase, or admin), via short-lived signed links
- Prices are always read from the database on the server. Payment is captured and verified (amount, currency, buyer) inside a Supabase Edge Function before the book is unlocked
- Row-level security on every table, so readers can only see their own progress, bookmarks and purchases

---

## Setup (about 20 minutes)

### 1. Supabase
1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. This creates the tables, security rules and the 3 storage buckets (`books` private, `covers` and `samples` public).
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Go to **Authentication → URL Configuration** and set **Site URL** to your website address (for example `https://mybooks.netlify.app`). Add the same address to **Redirect URLs**.
5. *(Optional)* **Storage → Settings**: the free plan allows files up to 50 MB. Raise the limit on a paid plan if your PDFs are bigger.

### 2. Configure the website
Edit `assets/js/config.js`:
```js
SUPABASE_URL: "https://abcd1234.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
PAYPAL_CLIENT_ID: "AXyz...",          // see step 4
SITE_NAME, AUTHOR_NAME, AUTHOR_BIO     // in ar / en / fr
DEFAULT_LANG: "ar",
```
All other text on the site is in `assets/js/locales.js` if you want to change wording.

### 3. Make yourself admin
1. Open the website, click **Sign in → Create one**, and register with your e-mail.
2. In Supabase **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Reload the site. **Dashboard** now appears in the menu. Click **Add a book**.

### 4. PayPal (for paid books)
1. Go to <https://developer.paypal.com> → **Apps & Credentials** → create an app. Start in **Sandbox** to test, then switch to **Live**.
2. Copy the **Client ID** into `config.js` (`PAYPAL_CLIENT_ID`).
3. Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then from this folder run:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... PAYPAL_ENV=sandbox
   supabase functions deploy paypal-create-order
   supabase functions deploy paypal-capture-order
   supabase functions deploy paypal-webhook --no-verify-jwt
   ```
4. *(Recommended)* In your PayPal app, open **Webhooks → Add webhook**:
   - URL: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/paypal-webhook`
   - Events: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`

   Then run `supabase secrets set PAYPAL_WEBHOOK_ID=<webhook id>`. This unlocks the book even if the buyer closes the page during payment, and removes access automatically after a refund.
5. When everything works in sandbox, put the **Live** Client ID in `config.js`, run `supabase secrets set PAYPAL_ENV=live` with your live secret, and redeploy the functions.

> **Currency:** PayPal does not support NGN, MAD or DZD. Sell in **USD or EUR** (chosen per book). PayPal converts for buyers automatically.

### 5. Publish the website
The site is static files, so any host works:
- **Netlify**: drag and drop this folder at <https://app.netlify.com/drop>
- **Vercel**: `vercel deploy` in this folder, or import it from GitHub
- **GitHub Pages / Cloudflare Pages / cPanel**: upload the files as they are

After publishing, set that address as the **Site URL** in Supabase (step 1.4) so the e-mail links (confirmation, password reset) open your site.

---

## Good to know

- **Auto-reader voices** come from the reader's device (free, no API key needed). Most phones and computers have English and French voices. Arabic voices exist on Android, iOS, macOS and Windows 11 but sometimes need to be installed in system settings; the reader shows a hint when none is found. Chrome and Edge usually have the best voices.
- **Scanned PDFs** (images of pages) can be read and downloaded, but they can't be searched or read aloud because they contain no text. Run OCR on them first (Adobe Acrobat, or free tools like `ocrmypdf`) for the best experience.
- **Arabic PDFs**: text exported from Word, InDesign or Google Docs works well. The reader also repairs PDFs that store Arabic letters in visual order, so search and read-aloud still work.
- **Download protection**: switching off "Allow PDF download" removes the button. Like any web reader (including Kindle Cloud Reader), a technically skilled person can still capture what they can read. Sell at fair prices and the honest majority will buy.
- E-mails (confirmation, password reset) are sent by Supabase. For your own domain and higher limits, set up custom SMTP in **Authentication → Emails**.

## Project structure
```
index.html                    app shell (import map with pinned library versions)
assets/css/styles.css         all styles (light/dark, RTL, reader themes)
assets/js/config.js           ← your settings
assets/js/locales.js          ← all texts in ar / en / fr
assets/js/app.js              router, header, footer
assets/js/api.js              every Supabase call
assets/js/pdf.js              pdf.js helpers (render, text extraction, covers)
assets/js/reader/tts.js       auto-reader engine
assets/js/payments/paypal.js  PayPal checkout
assets/js/pages/*.js          home, catalog, book, reader, library, auth, account, about, admin
supabase/schema.sql           database, security rules, storage
supabase/functions/*          PayPal edge functions (create, capture, webhook)
```
