import { config, STORAGE_KEYS } from "./config";
import type { Item, ParsedItem, PolishResult, DraftItem } from "./types";
import { applyResolve } from "./dates";
import { getSession } from "./auth";

let client: import("@supabase/supabase-js").SupabaseClient | null = null;

// Cache of the signed-in user's per-profile LLM config so parse/polish don't
// burn an extra profile round-trip on every phrase. Invalidated on settings
// save (updateSettings in settings.ts).
let profileLlmCache: { userId: string; key: string; provider: string } | null = null;
export function invalidateProfileCache(): void { profileLlmCache = null; }

async function sessionLlmConfig(session: { user: { id: string } }): Promise<{ key: string; provider: string }> {
  if (!profileLlmCache || profileLlmCache.userId !== session.user.id) {
    const profile = await fetchProfile(session.user.id);
    profileLlmCache = {
      userId: session.user.id,
      key: profile.llm_key || "",
      provider: profile.llm_provider || "nvidia"
    };
  }
  return { key: profileLlmCache.key, provider: profileLlmCache.provider };
}

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
  llm_key: string | null;
  llm_provider: string;
  show_deleted: boolean;
  deleted_auto_cleanup_days: number;
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
  let userKey = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
  let provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
  if (session) {
    const llm = await sessionLlmConfig(session);
    userKey = llm.key;
    provider = llm.provider;
  }

  // "nvidia" = use the free shared proxy (no key). Any other provider uses the saved key.
  if (provider === "nvidia" || !userKey) {
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

// --- Groq direct path (OpenAI-compat) ---
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";

// Strict schemas for Groq Structured Outputs (strict:true requires every
// field listed in `required` and `additionalProperties: false`). Nullable
// fields use a ["string","null"] union so the model can emit real nulls.
const PARSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    datetime: { type: ["string", "null"] },
    type: { type: "string", enum: ["todo", "event"] },
    reminder: { type: ["string", "null"] }
  },
  required: ["title", "datetime", "type", "reminder"],
  additionalProperties: false
};

const POLISH_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["todo", "event"] },
          datetime: { type: ["string", "null"] },
          reminder: { type: ["string", "null"] }
        },
        required: ["title", "kind", "datetime", "reminder"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
  additionalProperties: false
};

function groqStrictBody(sys: string, user: string, schemaName: string, schema: object) {
  return {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema }
    }
  };
}

function groqLenientBody(sys: string, user: string) {
  return {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  };
}

function groqPlainBody(sys: string, user: string) {
  return {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    temperature: 0.2
  };
}

function sleep(ms: number): Promise<void> {
  // Unit tests exercise the retry chain (attempt order, call counts) — real
  // backoff would add seconds per all-fail test, so skip the wait when
  // running under vitest. Production pacing is unchanged.
  if (import.meta.env?.MODE === "test") return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

function groqErrorMessage(j: any, status: number): string {
  const base = j?.error?.message || `groq error ${status}`;
  const failed = j?.error?.failed_generation;
  const detail = typeof failed === "string" ? failed.slice(0, 200) : "";
  return detail ? `${base} (${detail})` : base;
}

// POST to Groq and return the assistant's raw content string. The small
// gpt-oss-20b model fails constrained decoding intermittently — strict
// json_schema 400s ("Failed to validate/generate JSON", failed_generation)
// are transient and usually succeed on a prompt retry, so one user action
// fans out into several attempts here instead of surfacing "AI unavailable"
// and making the user tap again. Chain: strict x2, lenient json_object x3,
// then one plain call with no response_format. Content is parse-validated
// inside the loop so a 200 with empty/garbled JSON retries instead of
// throwing. Backoff with jitter between attempts; transport errors retry.
async function groqChatContent(opts: { key: string; sys: string; user: string; schemaName: string; schema: object }): Promise<string> {
  const bodies = [
    groqStrictBody(opts.sys, opts.user, opts.schemaName, opts.schema),
    groqStrictBody(opts.sys, opts.user, opts.schemaName, opts.schema),
    groqLenientBody(opts.sys, opts.user),
    groqLenientBody(opts.sys, opts.user),
    groqLenientBody(opts.sys, opts.user),
    groqPlainBody(opts.sys, opts.user)
  ];
  // Backoff between attempts (index i waits delays[i] before the next try).
  const delays = [400, 700, 700, 900, 900];
  let lastErr = "";
  for (let i = 0; i < bodies.length; i++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.key}` },
        body: JSON.stringify(bodies[i])
      });
      const j = await res.json().catch(() => ({}));
      const content = j?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        try {
          parseJsonLenient(content);
          return content;
        } catch {
          lastErr = `groq error: invalid JSON response (${content.trim().slice(0, 80)})`;
        }
      } else {
        lastErr = groqErrorMessage(j, res.status);
      }
      // Auth errors (401/403) are permanent — stop immediately. Other 4xx
      // (except retryable 400/429) are permanent too. A 200 with bad content
      // falls through to the retry below rather than breaking.
      if (res.status === 401 || res.status === 403) break;
      if (!res.ok && res.status !== 400 && res.status !== 429 && res.status < 500) break;
    } catch (e) {
      // Transport/abort failures are transient — retry with backoff.
      lastErr = e instanceof Error ? e.message : "groq error: network failure";
    }
    if (i < bodies.length - 1) {
      await sleep((delays[i] ?? 1000) + Math.random() * 250);
    }
  }
  throw new Error(lastErr || "groq error: empty response");
}

// Strip markdown fences (```json ... ```) the model sometimes adds despite
// JSON mode, then JSON.parse with repair fallbacks: extract the outer {...}
// when the model wraps JSON in prose (plain fallback call), and tolerate
// trailing commas (`,}` / `,]`). Throws a clear error when still unparseable.
export function parseJsonLenient(content: string): any {
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = (fenced ? fenced[1] : content).trim();
  const candidates: string[] = [raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start > 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of [...candidates]) candidates.push(c.replace(/,\s*([}\]])/g, "$1"));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next repair
    }
  }
  throw new Error(`groq error: invalid JSON response (${raw.slice(0, 80)})`);
}

async function parseDirect(phrase: string, provider: string, key: string): Promise<ParsedItem> {
  // Gemini: key-in-URL, responseSchema. Groq: OpenAI-compat, strict json_schema.
  const sys = "Output ONLY a valid JSON object, no commentary or markdown. Convert a scheduling phrase into JSON {title, datetime (ISO8601 or null), type ('todo'|'event'), reminder (ISO8601 or null)}. datetime present => event. A BARE weekday name with no clock time ('wednesday') is an ALL-DAY event on the NEAREST upcoming occurrence of that weekday (today counts; this week if still ahead, otherwise next week). Time-of-day words (morning 9am, afternoon 2pm, evening 6pm, tonight 8pm) are timed events at that hour, never todos. type 'todo' ONLY if no date or time-of-day is mentioned.";
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
  // groq / mistral (openai-compat) — strict json_schema constrains
  // gpt-oss-20b via Groq Structured Outputs, but constrained decoding fails
  // intermittently with 400 "Failed to validate/generate JSON"
  // (failed_generation), so groqChatContent fans out (strict x2, lenient
  // json_object x3, plain x1 with backoff) before surfacing the error.
  const content = await groqChatContent({
    key,
    sys,
    user: phrase,
    schemaName: "schedule_parse",
    schema: PARSE_SCHEMA
  });
  return normalize(parseJsonLenient(content));
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
  const session = await getSession();
  let userKey = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
  let provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
  if (session) {
    const llm = await sessionLlmConfig(session);
    userKey = llm.key;
    provider = llm.provider;
  }
  // The resolver is applied per cleaned title, so a weekday/time-of-day cue the
  // model drops from an item's title is not recovered (known limitation of the
  // dictate path; the draft editor lets the user fix dates before adding).
  if (provider === "nvidia" || !userKey) {
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
  const sys = "Output ONLY a valid JSON object, no commentary or markdown. Organize a rambling paragraph into a JSON object {items:[{title, kind('event'|'todo'), datetime(ISO8601 or null), reminder(ISO8601 or null)}]}. Split run-ons, one item per task, keep order/location/mode details in the title. Weekdays mean NEAREST upcoming occurrence from TODAY (same weekday today => today; e.g. Tue Sep 15 => Wed Sep 16, Thu Sep 17, Fri Sep 18). Weekday + clock ('Friday 8:30', 'Thursday 9', 'Wednesday 1:30', 'today 3:30', 'Friday 5 PM') is a TIMED event that day — combine, don't default to today. Time-of-day words make timed events never todos (morning 9am, afternoon 2pm, lunch/noon 12pm, evening 6pm, dinner 7pm, tonight/Tuesday-night 8pm, night 9pm). Deadlines are EVENTS with dates never dateless todos: 'by the 20th/15th' => all-day that day-of-month current month (next month only if passed); 'in N days' => today+N; 'ASAP/now' => today now. Otherwise event only with specific date/deadline/time-of-day; timeless wishes ('learn guitar, no clue when') => todo null. Recurrence ('every weekday') => ONE event next occurrence titled '(repeats weekdays)'. Resolve relative times to LOCAL time and current year. RELATIVE-NOW cues like 'in the next hour' / 'in 30 minutes' mean FROM NOW (today), never tomorrow. A bare weekday with no time ('wednesday') is an ALL-DAY event on the nearest upcoming occurrence. Cap at 100 items.";
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
    const content = await groqChatContent({
      key,
      sys,
      user: paragraph,
      schemaName: "schedule_polish",
      schema: POLISH_SCHEMA
    });
    parsed = parseJsonLenient(content);
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