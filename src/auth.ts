import { config } from "./config";
import type { Session } from "@supabase/supabase-js";

let clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(config.supabaseUrl, config.supabaseAnon, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    })();
  }
  return clientPromise;
}

export async function getSession(): Promise<Session | null> {
  const c = await getClient();
  const { data } = await c.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  let unsub: (() => void) | null = null;
  getClient().then((c) => {
    const { data } = c.auth.onAuthStateChange((_event, session) => cb(session ?? null));
    unsub = data.subscription.unsubscribe;
  });
  return () => { if (unsub) unsub(); };
}

function redirectTo(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

type Result = Promise<{ ok: boolean; message?: string }>;
function normalize(err: { message?: string } | null): { ok: boolean; message?: string } {
  if (!err) return { ok: true };
  return { ok: false, message: err.message ?? "Unknown error" };
}

export async function signInWithPassword(email: string, password: string): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  return normalize(error);
}

export async function signUpWithPassword(email: string, password: string): Result {
  const c = await getClient();
  const { error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
  return normalize(error);
}

export async function signInWithGoogle(): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  if (error && /popup_closed_by_user/i.test(error.message)) {
    return { ok: false, message: "Sign-in popup was closed." };
  }
  return normalize(error);
}

export async function signInWithGitHub(): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectTo() } });
  if (error && /popup_closed_by_user/i.test(error.message)) {
    return { ok: false, message: "Sign-in popup was closed." };
  }
  return normalize(error);
}

export async function sendPasswordReset(email: string): Result {
  const c = await getClient();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  return normalize(error);
}

export async function signOut(): Promise<void> {
  const c = await getClient();
  await c.auth.signOut();
}