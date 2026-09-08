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
- A BARE weekday name with no clock time ("wednesday") is an ALL-DAY EVENT on the NEAREST upcoming occurrence of that weekday (today counts; this week if still ahead, otherwise next week).
- Time-of-day words ("morning" 09:00, "afternoon" 14:00, "evening" 18:00, "tonight" 20:00, "night" 21:00) make TIMED EVENTS on that day — never todos.
- Otherwise, "event" only when a specific time is implied; otherwise "todo".
- Resolve relative cues (today, tomorrow, next Tuesday) to the user's LOCAL wall-clock time and current year.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
- Each title is a short, polished, grammatical label (no leading articles like "ok" or "so").
- Do not include commentary.`;
}

// CORS for browser-direct calls. Echo the request Origin when it is the
// configured app origin or a local dev server, so preflight from `npm run dev`
// (http://localhost:*) doesn't fail. Locked down to anything else.
function corsFor(req: Request): Record<string, string> {
  const allowed = Deno.env.get("APP_ORIGIN") || "*";
  const origin = req.headers.get("origin") ?? "";
  const isLocal = /^https?:\/\/localhost(:\d+)?$/.test(origin);
  const serve = (isLocal || allowed === "*" || origin === allowed) ? (origin || allowed) : allowed;
  return {
    "Access-Control-Allow-Origin": serve,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsFor(req) });

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
    return new Response(JSON.stringify({ error: "rate limited, try again shortly" }), { status: 429, headers: { ...corsFor(req), "content-type": "application/json" } });
  }

  const key = Deno.env.get("NVIDIA_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "parser not configured" }), { status: 500, headers: { ...corsFor(req), "content-type": "application/json" } });
  }

  let paragraph = "";
  let tzOffsetMinutes = 0;
  try {
    const body = await req.json();
    paragraph = (body.paragraph || "").toString().slice(0, 2000);
    const off = Number(body.tzOffsetMinutes);
    if (Number.isFinite(off)) tzOffsetMinutes = off;
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: { ...corsFor(req), "content-type": "application/json" } });
  }
  if (!paragraph) {
    return new Response(JSON.stringify({ error: "empty paragraph" }), { status: 400, headers: { ...corsFor(req), "content-type": "application/json" } });
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
    return new Response(JSON.stringify({ error: "nvidia error", detail: text }), { status: 502, headers: { ...corsFor(req), "content-type": "application/json" } });
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

  return new Response(JSON.stringify(out), { headers: { ...corsFor(req), "content-type": "application/json" } });
});
