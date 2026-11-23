// Global auth/session state
import { supabase } from "./supabase.js";

export const state = { session: null, user: null, profile: null, ready: false };
const listeners = new Set();

export const isAdmin = () => state.profile?.role === "admin";
export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (userChanged) => listeners.forEach((fn) => fn(state, userChanged));

async function loadProfile() {
  if (!state.user) return (state.profile = null);
  const { data } = await supabase.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  state.profile = data ?? { id: state.user.id, email: state.user.email, role: "reader" };
}

async function applySession(session) {
  const prevId = state.user?.id ?? null;
  state.session = session;
  state.user = session?.user ?? null;
  const userChanged = (state.user?.id ?? null) !== prevId;
  if (userChanged) await loadProfile();
  state.ready = true;
  emit(userChanged);
}

export async function initAuth() {
  if (!supabase) { state.ready = true; return; }
  const { data } = await supabase.auth.getSession();
  await applySession(data.session);
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") location.hash = "#/reset";
    // Never await Supabase calls directly inside this callback (can deadlock) → defer.
    setTimeout(() => applySession(session), 0);
  });
}

export async function refreshProfile() {
  await loadProfile();
  emit(false);
}
