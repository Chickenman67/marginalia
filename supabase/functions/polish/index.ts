// Supabase Edge Function: /functions/v1/polish
// Holds David's NVIDIA key server-side, enforces space-token auth + a global
// rate limit, and forwards a rambling paragraph to NVIDIA's NIM endpoint to be
// organized into a clean list of discrete tasks/events.
// Deployed with: supabase functions deploy polish --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "mistralai/mistral-nemotron";

// Rate limiting is durable + per-space, enforced in Postgres via
// public.check_rate_limit (called after the space token is validated).

function localNow(tzOffsetMinutes: number): Date {
  return new Date(Date.now() + tzOffsetMinutes * 60000);
}

function SYSTEM(tzOffsetMinutes: number): string {
  const now = localNow(tzOffsetMinutes);
  return `You organize a rambling speech or note into a clean list of discrete tasks and events.
Output ONLY valid JSON of the form:
{ "items": [ { "title": string, "kind": "todo"|"event", "datetime": ISO8601 with timezone and CURRENT year (${now.getFullYear()}) or null, "reminder": ISO8601 or null } ] }
The user's CURRENT local time RIGHT NOW is: ${now.toString()} (their local offset from UTC is ${tzOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tzOffsetMinutes)} minutes).
Rules:
- Split run-on sentences into separate items.
- "event" only when a specific time is implied; otherwise "todo".
- Resolve relative cues (today, tomorrow, next Tuesday) to the user's LOCAL wall-clock time and current year.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
- Each title is a short, polished, grammatical label (no leading articles like "ok" or "so").
- Do not include commentary.`;
}

Deno.serve(async (req) => {
  // CORS for browser-direct calls. Restrict to the deployed app origin.
  // Set APP_ORIGIN (supabase secrets set APP_ORIGIN=https://your-site.example).
  const ALLOWED_ORIGIN = Deno.env.get("APP_ORIGIN") || "*";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type, authorization, x-space-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Require a space token so anonymous demo users can't call unauthenticated.
  const spaceToken = req.headers.get("x-space-token");
  if (!spaceToken) {
    return new Response(JSON.stringify({ error: "missing space token" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  }

  // Split id.secret and validate both halves against the spaces table.
  const dot = spaceToken.indexOf(".");
  const spaceId = dot === -1 ? spaceToken : spaceToken.slice(0, dot);
  const spaceSecret = dot === -1 ? "" : spaceToken.slice(dot + 1);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: space, error: spErr } = await supabase
    .from("spaces").select("token").eq("token", spaceId).eq("secret", spaceSecret).maybeSingle();
  if (spErr || !space) {
    return new Response(JSON.stringify({ error: "unauthorized space" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  }

  // Durable, per-space rate limit (NVIDIA is free but shared; protect the quota).
  const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
    p_space: spaceId,
    p_max: 30,
    p_window_sec: 60
  });
  if (rlErr || !allowed) {
    return new Response(JSON.stringify({ error: "rate limited, try again shortly" }), { status: 429, headers: { ...cors, "content-type": "application/json" } });
  }

  const key = Deno.env.get("NVIDIA_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "parser not configured" }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }

  let paragraph = "";
  let tzOffsetMinutes = 0;
  try {
    const body = await req.json();
    paragraph = (body.paragraph || "").toString().slice(0, 2000);
    const off = Number(body.tzOffsetMinutes);
    if (Number.isFinite(off)) tzOffsetMinutes = off;
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
  if (!paragraph) {
    return new Response(JSON.stringify({ error: "empty paragraph" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }

  // keep space token alive (optional, ignores errors)
  try {
    await supabase.from("spaces").update({ last_active_at: new Date().toISOString() }).eq("token", spaceId);
  } catch { /* non-fatal */ }

  const nvidiaRes = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM(tzOffsetMinutes) },
        { role: "user", content: paragraph }
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
  try { parsed = JSON.parse(content); } catch { parsed = { items: [] }; }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const out = {
    items: items.slice(0, 100).map((it: any) => ({
      title: String(it.title || it.phrase || "").slice(0, 120),
      kind: it.kind === "event" ? "event" : "todo",
      datetime: it.datetime || null,
      reminder: it.reminder || null
    }))
  };

  return new Response(JSON.stringify(out), { headers: { ...cors, "content-type": "application/json" } });
});
