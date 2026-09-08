import { config, STORAGE_KEYS } from "./config";
import type { Item, ParsedItem, PolishResult, DraftItem } from "./types";
import { applyResolve } from "./dates";
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
  due_include_overdue: boolean;
  due_days_ahead: number;
  past_due_color: string | null;
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
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";

  // "nvidia" = use the free shared proxy (no key). Any other provider uses the saved key.
  if (provider === "nvidia" || !userKey) {
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
    return applyResolve((await r.json()) as ParsedItem, phrase);
  }
  return applyResolve(await parseDirect(phrase, provider, userKey), phrase);
}

async function parseDirect(phrase: string, provider: string, key: string): Promise<ParsedItem> {
  // Gemini: key-in-URL, responseSchema. Groq: OpenAI-compat, json_object.
  const sys = "Convert a scheduling phrase into JSON {title, datetime (ISO8601 or null), type ('todo'|'event'), reminder (ISO8601 or null)}. datetime present => event. A BARE weekday name with no clock time ('wednesday') is an ALL-DAY event on the NEAREST upcoming occurrence of that weekday (today counts; this week if still ahead, otherwise next week). Time-of-day words (morning 9am, afternoon 2pm, evening 6pm, tonigh 8pm) are timed events at that hour, never todos. type 'todo' ONLY if no date or time-of-day is mentioned.";
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: phrase }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { title: { type: "STRING" }, datetime: { type: "STRING" }, type: { type: "STRING" }, reminder: { type: "STRING" } } }
        }
      })
    });
    const j = await res.json();
    if (!res.ok || !j.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error(`gemini error: ${j.error?.message || res.status}`);
    }
    return normalize(JSON.parse(j.candidates[0].content.parts[0].text));
  }
  // groq / mistral (openai-compat)
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "system", content: sys }, { role: "user", content: phrase }], response_format: { type: "json_object" } })
  });
  const j = await res.json();
  if (!res.ok || !j.choices?.[0]?.message?.content) {
    throw new Error(`groq error: ${j.error?.message || res.status}`);
  }
  return normalize(JSON.parse(j.choices[0].message.content));
}

function asLocalISO(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0), 0);
  if (isNaN(dt.getTime())) return s;
  return dt.toISOString();
}

function normalize(j: any): ParsedItem {
  const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
  const datetime = asLocalISO(j.datetime || j.start);
  return {
    title: String(j.title ?? "Untitled").slice(0, 120),
    kind,
    datetime,
    allDay: !!(j.allDay),
    reminder: j.reminder ? asLocalISO(j.reminder) : null
  };
}

function normalizeDraft(j: any): DraftItem {
  const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
  const datetime = asLocalISO(j.datetime || j.start);
  return {
    title: String(j.title ?? "Untitled").slice(0, 120),
    kind,
    datetime,
    allDay: !!(j.allDay),
    reminder: j.reminder ? asLocalISO(j.reminder) : null
  };
}

export async function polishPhrase(paragraph: string): Promise<PolishResult> {
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
  if (provider === "nvidia" || !userKey) {
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
    const proxied = (await r.json()) as PolishResult;
    return { items: proxied.items.map((it) => applyResolve(it, it.title)) };
  }
  const direct = await polishDirect(paragraph, provider, userKey);
  return { items: direct.items.map((it) => applyResolve(it, it.title)) };
}

async function polishDirect(paragraph: string, provider: string, key: string): Promise<PolishResult> {
  const sys = "Organize a rambling paragraph into a JSON object {items:[{title, kind('event'|'todo'), datetime(ISO8601 or null), reminder(ISO8601 or null)}]}. If a line has a time it is an event, otherwise a todo. Resolve relative times to the user's LOCAL time and current year. RELATIVE-NOW cues like 'in the next hour' / 'in 30 minutes' mean FROM NOW (today), never tomorrow — anchor on the current time. A bare weekday with no time ('wednesday') is an ALL-DAY event on the nearest upcoming occurrence of that weekday (this week, else next week). Time-of-day words make timed events, never todos. Cap at 100 items.";
  let parsed: any;
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: paragraph }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: { title: { type: "STRING" }, kind: { type: "STRING" }, datetime: { type: "STRING" }, reminder: { type: "STRING" } }
                }
              }
            }
          }
        }
      })
    });
    const j = await res.json();
    if (!res.ok || !j.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error(`gemini error: ${j.error?.message || res.status}`);
    }
    parsed = JSON.parse(j.candidates[0].content.parts[0].text);
    } else {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "system", content: sys }, { role: "user", content: paragraph }], response_format: { type: "json_object" } })
    });
    const j = await res.json();
    if (!res.ok || !j.choices?.[0]?.message?.content) {
      throw new Error(`groq error: ${j.error?.message || res.status}`);
    }
    parsed = JSON.parse(j.choices[0].message.content);
  }
  const items: DraftItem[] = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 100).map(normalizeDraft);
  return { items };
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
    if (!config.parseFunction) {
      return { ok: false, message: "NVIDIA proxy not configured (no Supabase link)." };
    }
    try {
      const session = await getSession();
      if (!session) return { ok: false, message: "Sign in first, then test the NVIDIA proxy." };
      const res = await fetch(config.parseFunction, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ phrase: "test", tzOffsetMinutes: tzOffsetMinutes() })
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