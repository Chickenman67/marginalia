// Supabase Edge Function: /functions/v1/parse
// Holds David's NVIDIA key server-side, enforces space-token auth + a global
// rate limit, and forwards natural-language phrases to NVIDIA's NIM endpoint.
// Deployed with: supabase functions deploy parse --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "meta/llama-3.1-8b-instruct";

// Simple in-memory rate limit (per edge instance). Swap for Redis/KV if needed.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length && hits[0] < now - WINDOW_MS) hits.shift();
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  return false;
}

const SYSTEM = `Convert a scheduling phrase into JSON. Output ONLY valid JSON with these fields:
- title: short task label (string)
- datetime: ISO 8601 with timezone and CURRENT year (${new Date().getFullYear()}), or null if no specific time
- type: "todo" if no time given, otherwise "event"
- reminder: ISO 8601 time to remind, or null
Resolve relative cues (today, tomorrow, next Tuesday) to the user's local time and the current year. Do not include commentary.`;

Deno.serve(async (req) => {
  // CORS for browser-direct calls
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, x-space-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Require a space token so anonymous demo users can't call unauthenticated.
  const spaceToken = req.headers.get("x-space-token");
  if (!spaceToken) {
    return new Response(JSON.stringify({ error: "missing space token" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  }

  if (rateLimited()) {
    return new Response(JSON.stringify({ error: "rate limited, try again shortly" }), { status: 429, headers: { ...cors, "content-type": "application/json" } });
  }

  const key = Deno.env.get("NVIDIA_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "parser not configured" }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }

  let phrase = "";
  try {
    const body = await req.json();
    phrase = (body.phrase || "").toString().slice(0, 500);
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
  if (!phrase) {
    return new Response(JSON.stringify({ error: "empty phrase" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }

  // keep space token alive (optional, ignores errors)
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE")!, { auth: { persistSession: false } });
    await supabase.from("spaces").update({ last_active_at: new Date().toISOString() }).eq("token", spaceToken);
  } catch { /* non-fatal */ }

  const nvidiaRes = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: phrase }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });

  if (!nvidiaRes.ok) {
    const text = await nvidiaRes.text();
    return new Response(JSON.stringify({ error: "nvidia error", detail: text }), { status: 502, headers: { ...cors, "content-type": "application/json" } });
  }

  const data = await nvidiaRes.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { parsed = { title: phrase, type: "todo" }; }

  const out = {
    title: String(parsed.title ?? phrase).slice(0, 120),
    kind: parsed.type === "event" ? "event" : "todo",
    datetime: parsed.datetime || null,
    reminder: parsed.reminder || (parsed.type === "event" ? parsed.datetime : null)
  };

  return new Response(JSON.stringify(out), { headers: { ...cors, "content-type": "application/json" } });
});
