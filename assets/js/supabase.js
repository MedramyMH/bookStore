import { createClient } from "@supabase/supabase-js";
import { CONFIG, isConfigured } from "./config.js";

export const supabase = isConfigured()
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",          // keeps auth codes in ?query, not #hash (we use hash routing)
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
