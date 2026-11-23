// =====================================================================
//  SITE CONFIGURATION — edit this file, nothing else is required.
// =====================================================================
export const CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: "https://yoempvdedunvxivdljah.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_DFYWmWcslULLbf6RPxSusA__4KPOGvE",



  // PayPal Developer Dashboard → Apps & Credentials → your app → Client ID
  // (use the Sandbox client id while testing, the Live one in production)
  PAYPAL_CLIENT_ID: "YOUR-PAYPAL-CLIENT-ID",

  // Branding
  SITE_NAME: { en: "Maktaba", fr: "Maktaba", ar: "مكتبة" },
  AUTHOR_NAME: { en: "Your Name", fr: "Votre Nom", ar: "اسمك" },
  AUTHOR_BIO: {
    en: "Writer and thinker. Here you will find all my books — read them online, download them, or support my work by buying them.",
    fr: "Écrivain et penseur. Retrouvez ici tous mes livres — lisez-les en ligne, téléchargez-les ou soutenez mon travail en les achetant.",
    ar: "كاتب ومفكر. ستجد هنا جميع كتبي — اقرأها مباشرة، حمّلها، أو ادعم عملي بشرائها.",
  },
  AUTHOR_PHOTO: "", // optional URL of your photo
  CONTACT_EMAIL: "", // optional
  SOCIAL: { facebook: "", x: "", instagram: "", youtube: "" }, // optional URLs

  DEFAULT_LANG: "ar",          // 'ar' | 'en' | 'fr' — used when the visitor's browser language is unknown
  DEFAULT_CURRENCY: "USD",     // PayPal does not support NGN/MAD/DZD; USD or EUR is recommended
  ENABLE_GOOGLE_LOGIN: false,  // turn on after enabling Google in Supabase → Authentication → Providers
  PAGE_SIZE: 24,
};

export const isConfigured = () =>
  !CONFIG.SUPABASE_URL.includes("YOUR-PROJECT") && !CONFIG.SUPABASE_ANON_KEY.startsWith("YOUR-");
