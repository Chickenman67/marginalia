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
export async function subscribeToSpace(token: string, onUpdate: (items: Item[]) => void): Promise<void> {
  const supabase = await getClient();
  supabase
    .channel(`space:${token}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `space_token=eq.${getSpaceId()}` }, async () => {
      onUpdate(await fetchItems());
    })
    .subscribe();
}

// --- LLM parsing via proxy (default) or direct provider (fallback key) ---
export async function parsePhrase(phrase: string): Promise<ParsedItem> {
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";

  // A saved key takes priority over the (slow/unreliable) shared NVIDIA proxy,
  // regardless of the dropdown default — the user explicitly wants their key used.
  if (userKey) {
    return parseDirect(phrase, provider === "nvidia" ? "gemini" : provider, userKey);
  }
  // default: NVIDIA via Supabase Edge Function proxy
  const res = await fetch(config.parseFunction, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.supabaseAnon}`,
      "x-space-token": getSpaceToken()
    },
    body: JSON.stringify({ phrase })
  });
  if (!res.ok) throw new Error(`parse failed: ${res.status}`);
  const json = await res.json();
  return normalize(json);
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
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sys }, { role: "user", content: phrase }], response_format: { type: "json_object" } })
  });
  const j = await res.json();
  if (!res.ok || !j.choices?.[0]?.message?.content) {
    throw new Error(`groq error: ${j.error?.message || res.status}`);
  }
  return normalize(JSON.parse(j.choices[0].message.content));
}

function normalize(j: any): ParsedItem {
  const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
  const datetime = j.datetime || j.start || null;
  return {
    title: String(j.title ?? "Untitled").slice(0, 120),
    kind,
    datetime: datetime || null,
    reminder: j.reminder || (kind === "event" ? datetime : null)
  };
}

function normalizeDraft(j: any): DraftItem {
  const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
  const datetime = j.datetime || j.start || null;
  return {
    title: String(j.title ?? "Untitled").slice(0, 120),
    kind,
    datetime: datetime || null,
    reminder: j.reminder || (kind === "event" ? datetime : null)
  };
}

// --- Polish: turn a rambling paragraph into a list of draft items ---
export async function polishPhrase(paragraph: string): Promise<PolishResult> {
  const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
  const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
  if (userKey) {
    return polishDirect(paragraph, provider === "nvidia" ? "gemini" : provider, userKey);
  }
  const res = await fetch(config.parseFunction.replace(/\/parse$/, "/polish"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnon}`, "x-space-token": getSpaceToken() },
    body: JSON.stringify({ paragraph })
  });
  if (!res.ok) throw new Error(`polish failed: ${res.status}`);
  return (await res.json()) as PolishResult;
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

// Verify a user-supplied provider key with a tiny test request.
// Returns { ok, message }. Surfaces the real provider error (bad key, quota…).
export async function testProviderKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  if (!key.trim()) return { ok: false, message: "No key entered." };
  // "nvidia" with a key is treated as a Gemini key (the proxy default uses no key).
  const p = provider === "nvidia" ? "gemini" : provider;
  try {
    const res = p === "gemini"
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "reply with the single word ok" }] }] })
        })
      : await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "reply with the single word ok" }] })
        });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: p === "gemini" ? `Gemini: ${j.error?.message || res.status}` : `Groq: ${j.error?.message || res.status}` };
    }
    return { ok: true, message: `${p} key works.` };
  } catch (e) {
    return { ok: false, message: `Network error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

async function polishDirect(paragraph: string, provider: string, key: string): Promise<PolishResult> {
  const sys = "Organize a rambling paragraph into a JSON object {items:[{title, kind('event'|'todo'), datetime(ISO8601 or null), reminder(ISO8601 or null)}]}. If a line has a time it is an event, otherwise a todo. Resolve relative times (today/tomorrow/next week) to the actual date in the current year. Cap at 100 items.";
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
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sys }, { role: "user", content: paragraph }], response_format: { type: "json_object" } })
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
