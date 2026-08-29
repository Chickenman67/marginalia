import { config, STORAGE_KEYS } from "./config";
import type { Item, ParsedItem, PolishResult, DraftItem } from "./types";
import { getSpaceToken, getSpaceId, genTokenPair } from "./store";

let client: import("@supabase/supabase-js").SupabaseClient | null = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  // Forward the space token on every request so RLS (keyed on x-space-token) matches.
  client = createClient(config.supabaseUrl, config.supabaseAnon, {
    auth: { persistSession: false },
    global: { headers: { "x-space-token": getSpaceToken() } }
  });
  return client;
}

export async function fetchItems(): Promise<Item[]> {
  const supabase = await getClient();
  const token = getSpaceId();
  await ensureSpace(supabase, getSpaceToken());
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("space_token", token)
    .order("order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Item[]) ?? [];
}

async function ensureSpace(supabase: any, token: string): Promise<void> {
  // idempotent: create the space row if missing so inserts/selects pass FK + RLS.
  // Split the combined token into its id/secret components; spaces rows store the id.
  const dot = token.indexOf(".");
  const id = dot === -1 ? token : token.slice(0, dot);
  const secret = dot === -1 ? "" : token.slice(dot + 1);
  await supabase.from("spaces").upsert({ token: id, secret, last_active_at: new Date().toISOString() }, { onConflict: "token" });
}

export async function insertItem(item: Item): Promise<Item> {
  const supabase = await getClient();
  await ensureSpace(supabase, item.space_token);
  const { data, error } = await supabase.from("items").insert(item).select().single();
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

// Realtime: only this space's rows. RLS scopes the channel server-side too.
export async function subscribeToSpace(onUpdate: (items: Item[]) => void): Promise<void> {
  const supabase = await getClient();
   supabase
    .channel(`space:${getSpaceId()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `space_token=eq.${getSpaceId()}` }, async () => {
      onUpdate(await fetchItems());
    })
    .subscribe();
}

// The browser's real UTC offset (minutes). Positive = ahead of UTC. The parser
// uses this so it anchors "now" to the user's actual local clock.
function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

// --- LLM parsing via proxy (NVIDIA default) or direct provider (user key) ---
export async function parsePhrase(phrase: string): Promise<ParsedItem> {
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";

  // "nvidia" = use the free shared proxy (no key). Any other provider uses the saved key.
  if (provider === "nvidia" || !userKey) {
    // default: NVIDIA via Supabase Edge Function proxy
    const res = await fetch(config.parseFunction, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.supabaseAnon}`,
        "x-space-token": getSpaceToken()
      },
      body: JSON.stringify({ phrase, tzOffsetMinutes: tzOffsetMinutes() })
    });
    if (!res.ok) throw new Error(`parse failed: ${res.status}`);
    const json = await res.json();
    return normalize(json);
  }
  return parseDirect(phrase, provider, userKey);
}

async function parseDirect(phrase: string, provider: string, key: string): Promise<ParsedItem> {
  // Gemini: key-in-URL, responseSchema. Groq: OpenAI-compat, json_object.
  const sys = "Convert a scheduling phrase into JSON {title, datetime (ISO8601 or null), type ('todo'|'event'), reminder (ISO8601 or null)}. datetime present => event.";
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

// The LLM is asked for local wall-clock time but often returns a UTC/Z timestamp
// (or omits the offset). Interpreting that as-is shifts the time by the local
// UTC offset. This pins the returned wall-clock to the user's LOCAL timezone so
// "8:37 PM" actually lands at 8:37 PM on their device.
function asLocalISO(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s; // can't parse; leave as-is
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
    reminder: asLocalISO(j.reminder || (kind === "event" ? j.datetime || j.start : null))
  };
}

function normalizeDraft(j: any): DraftItem {
  const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
  const datetime = asLocalISO(j.datetime || j.start);
  return {
    title: String(j.title ?? "Untitled").slice(0, 120),
    kind,
    datetime,
    reminder: asLocalISO(j.reminder || (kind === "event" ? j.datetime || j.start : null))
  };
}

// --- Polish: turn a rambling paragraph into a list of draft items ---
export async function polishPhrase(paragraph: string): Promise<PolishResult> {
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
  if (provider === "nvidia" || !userKey) {
    const res = await fetch(config.parseFunction.replace(/\/parse$/, "/polish"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnon}`, "x-space-token": getSpaceToken() },
      body: JSON.stringify({ paragraph, tzOffsetMinutes: tzOffsetMinutes() })
    });
    if (!res.ok) throw new Error(`polish failed: ${res.status}`);
    return (await res.json()) as PolishResult;
  }
  return polishDirect(paragraph, provider, userKey);
}

export async function migrateLegacyToken(oldToken: string): Promise<{ id: string; secret: string }> {
  const { id, secret } = genTokenPair();
  const res = await fetch(config.parseFunction.replace(/\/parse$/, "/migrate-token"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnon}` },
    body: JSON.stringify({ oldToken, newId: id, newSecret: secret })
  });
  if (!res.ok) throw new Error(`migrate failed: ${res.status}`);
  const j = await res.json();
  if (!j.ok) throw new Error("migrate rejected");
  return { id, secret };
}

// Verify a provider key with a tiny test request (NVIDIA = no key, tests the proxy).
// Returns { ok, message }. Surfaces the real provider error (bad key, quota…).
export async function testProviderKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  if (provider === "nvidia") {
    try {
      const res = await fetch(config.parseFunction, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnon}`, "x-space-token": getSpaceToken() },
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

async function polishDirect(paragraph: string, provider: string, key: string): Promise<PolishResult> {
  const sys = "Organize a rambling paragraph into a JSON object {items:[{title, kind('event'|'todo'), datetime(ISO8601 or null), reminder(ISO8601 or null)}]}. If a line has a time it is an event, otherwise a todo. Resolve relative times to the user's LOCAL time and current year. RELATIVE-NOW cues like 'in the next hour' / 'in 30 minutes' mean FROM NOW (today), never tomorrow — anchor on the current time. Weekday names resolve to the NEXT occurrence from today. Cap at 100 items.";
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
