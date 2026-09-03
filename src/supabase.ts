import { config } from "./config";
import type { Item, ParsedItem, PolishResult } from "./types";
import { getSession } from "./auth";

let client: import("@supabase/supabase-js").SupabaseClient | null = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(config.supabaseUrl, config.supabaseAnon, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return client;
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  color_rules: ColorRule[];
  auto_remind_events: boolean;
  military_time: boolean;
  auto_delete: boolean;
  auto_delete_days: number;
  provider: string;
  updated_at: string;
}

interface ColorRule {
  id: string;
  label: string;
  color: string;
  withinHours: number;
}

export async function fetchItems(): Promise<Item[]> {
  const supabase = await getClient();
  const session = await getSession();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("user_id", session!.user.id)
    .order("order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Item[]) ?? [];
}

export async function insertItem(item: Item): Promise<Item> {
  const supabase = await getClient();
  const session = await getSession();
  const { data, error } = await supabase
    .from("items")
    .insert({ ...item, user_id: session!.user.id })
    .select()
    .single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(id: string, patch: Partial<Item>): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.from("items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removeItem(id: string): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
}

export async function subscribeToSpace(onUpdate: (items: Item[]) => void): Promise<void> {
  const supabase = await getClient();
  const session = await getSession();
  const userId = session!.user.id;
  supabase
    .channel(`user:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `user_id=eq.${userId}` }, async () => {
      onUpdate(await fetchItems());
    })
    .subscribe();
}

function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export async function parsePhrase(phrase: string): Promise<ParsedItem> {
  const session = await getSession();
  const r = await fetch(config.parseFunction, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${session!.access_token}`
    },
    body: JSON.stringify({ phrase, tzOffsetMinutes: tzOffsetMinutes() })
  });
  if (!r.ok) throw new Error(`parse failed: ${r.status}`);
  return (await r.json()) as ParsedItem;
}

export async function polishPhrase(paragraph: string): Promise<PolishResult> {
  const session = await getSession();
  const polishUrl = config.parseFunction.replace(/\/parse$/, "/polish");
  const r = await fetch(polishUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${session!.access_token}`
    },
    body: JSON.stringify({ paragraph, tzOffsetMinutes: tzOffsetMinutes() })
  });
  if (!r.ok) throw new Error(`polish failed: ${r.status}`);
  return (await r.json()) as PolishResult;
}

// --- Profiles ---
export async function fetchProfile(userId: string): Promise<Profile> {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(userId: string, patch: Partial<Profile>): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}

// --- Test-provider-key (unchanged signature; drop token header) ---
export async function testProviderKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  if (provider === "nvidia") {
    try {
      const res = await fetch(config.parseFunction, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnon}` },
        body: JSON.stringify({ phrase: "test" })
      });
      return res.ok
        ? { ok: true, message: "NVIDIA proxy works (no key needed)." }
        : { ok: false, message: `Proxy error (${res.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${e instanceof Error ? e.message : "unknown"}` };
    }
  }
  if (!key.trim()) return { ok: false, message: "No key entered." };
  try {
    const res = provider === "gemini"
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "reply with the single word ok" }] }] })
        })
      : await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "reply with the single word ok" }] })
        });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: provider === "gemini" ? `Gemini: ${j.error?.message || res.status}` : `Groq: ${j.error?.message || res.status}` };
    }
    return { ok: true, message: `${provider} key works.` };
  } catch (e) {
    return { ok: false, message: `Network error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}