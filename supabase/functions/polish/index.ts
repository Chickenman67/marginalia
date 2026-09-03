// Supabase Edge Function: /functions/v1/polish
// Holds David's NVIDIA key server-side, enforces JWT auth + a per-user
// rate limit, and forwards a rambling paragraph to NVIDIA's NIM endpoint to be
// organized into a clean list of discrete tasks/events.
// Deployed with: supabase functions deploy polish

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
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // --- Auth: verify the Supabase JWT from the Authorization header ---
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return new Response("missing bearer token", { status: 401 });
  const jwt = m[1];
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return new Response("invalid token", { status: 401 });
  const userId = userData.user.id;

  // Durable, per-user rate limit (NVIDIA is free but shared; protect the quota).
  const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
    p_space: userId,
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
