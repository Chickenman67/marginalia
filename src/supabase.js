import { config, STORAGE_KEYS } from "./config";
import { getSpaceToken } from "./store";
let client = null;
async function getClient() {
    if (client)
        return client;
    const { createClient } = await import("@supabase/supabase-js");
    // Forward the space token on every request so RLS (keyed on x-space-token) matches.
    client = createClient(config.supabaseUrl, config.supabaseAnon, {
        auth: { persistSession: false },
        global: { headers: { "x-space-token": getSpaceToken() } }
    });
    return client;
}
export async function fetchItems() {
    const supabase = await getClient();
    const token = getSpaceToken();
    await ensureSpace(supabase, token);
    const { data, error } = await supabase
        .from("items")
        .select("*")
        .eq("space_token", token)
        .order("created_at", { ascending: true });
    if (error)
        throw error;
    return data ?? [];
}
async function ensureSpace(supabase, token) {
    // idempotent: create the space row if missing so inserts/selects pass FK + RLS.
    await supabase.from("spaces").upsert({ token, last_active_at: new Date().toISOString() }, { onConflict: "token" });
}
export async function insertItem(item) {
    const supabase = await getClient();
    await ensureSpace(supabase, item.space_token);
    const { data, error } = await supabase.from("items").insert(item).select().single();
    if (error)
        throw error;
    return data;
}
export async function updateItem(id, patch) {
    const supabase = await getClient();
    const { error } = await supabase.from("items").update(patch).eq("id", id);
    if (error)
        throw error;
}
export async function removeItem(id) {
    const supabase = await getClient();
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error)
        throw error;
}
// Realtime: only this space's rows. RLS scopes the channel server-side too.
export async function subscribeToSpace(token, onUpdate) {
    const supabase = await getClient();
    supabase
        .channel(`space:${token}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `space_token=eq.${token}` }, async () => {
        onUpdate(await fetchItems());
    })
        .subscribe();
}
// --- LLM parsing via proxy (default) or direct provider (fallback key) ---
export async function parsePhrase(phrase) {
    const userKey = localStorage.getItem(STORAGE_KEYS.llmKey);
    const provider = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
    if (userKey && provider !== "nvidia") {
        return parseDirect(phrase, provider, userKey);
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
    if (!res.ok)
        throw new Error(`parse failed: ${res.status}`);
    const json = await res.json();
    return normalize(json);
}
async function parseDirect(phrase, provider, key) {
    // Gemini: key-in-URL, responseSchema. Groq: OpenAI-compat, json_object.
    const sys = "Convert a scheduling phrase into JSON {title, datetime (ISO8601 or null), type ('todo'|'event'), reminder (ISO8601 or null)}. datetime present => event.";
    if (provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
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
        return normalize(JSON.parse(j.candidates[0].content.parts[0].text));
    }
    // groq / mistral (openai-compat)
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sys }, { role: "user", content: phrase }], response_format: { type: "json_object" } })
    });
    const j = await res.json();
    return normalize(JSON.parse(j.choices[0].message.content));
}
function normalize(j) {
    const kind = j.type === "event" || j.kind === "event" ? "event" : "todo";
    const datetime = j.datetime || j.start || null;
    return {
        title: String(j.title ?? "Untitled").slice(0, 120),
        kind,
        datetime: datetime || null,
        reminder: j.reminder || (kind === "event" ? datetime : null)
    };
}
