// Supabase Edge Function: /functions/v1/polish
// Holds David's NVIDIA key server-side, enforces JWT auth + a per-user
// rate limit, and forwards a rambling paragraph to NVIDIA's NIM endpoint to be
// organized into a clean list of discrete tasks/events.
// Deployed with: supabase functions deploy polish

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
// Same fallback chain as parse: NVIDIA's free shared tier 502/504s and drops
// models, so try each in turn — smallest fast MoE first, then larger instruct.
const MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/nemotron-nano-3-30b-a3b"
];

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
- Split run-on sentences into separate items. Keep one item per task/errand. Preserve order notes in the title (e.g. "Dry cleaners first, then Costco").
- Preserve key details in the title: location ("downtown"), mode ("virtual — check link"), people ("with Michael"), strictness ("no later").
- Weekday resolution: "this Friday", "Friday", "Thursday", "Wednesday", etc. mean the NEAREST upcoming occurrence counting from TODAY local. Same weekday stated today => today. Example: if today is Tuesday Sep 15, then Wednesday => Sep 16, Thursday => Sep 17, Friday => Sep 18. Never emit a past date for a future cue, and never shift by a week unless that weekday already passed.
- Weekday WITH a clock time ("dentist Friday at 8:30", "Thursday at 9", "Wednesday around 1:30", "today at 3:30", "report due Friday by 5 PM") is a TIMED event on that weekday at that hour/minute. Combine them — do not drop the weekday and do not default to today.
- Time-of-day words make TIMED EVENTS, never todos: "morning" => 09:00, "afternoon" => 14:00, "lunch"/"noon" => 12:00, "evening" => 18:00, "dinner" => 19:00, "tonight"/"Tuesday night" => 20:00, "night" => 21:00 — that day if the hour is still ahead, else next day. "Tuesday night" on a Tuesday => tonight 20:00.
- Deadlines are EVENTS with dates, never dateless todos: "by the 20th"/"by the 15th" => all-day event on that day-of-month in the current month (next month only if that date already passed); "in three days"/"in N days" => today + N days; "ASAP"/"right now" => today at the current local time; "by morning/afternoon/evening" => today at that hour if still ahead, else tomorrow.
- Otherwise, "event" only when a specific date, deadline, or time-of-day is implied; a wish with no time at all ("learn guitar, no clue when") => type "todo", datetime null.
- Recurrence ("every weekday at 10") is single-occurrence only: emit ONE event for the next occurrence (today at 10:00 if still ahead, else tomorrow) and note "(repeats weekdays)" in the title. Never drop it silently.
- Resolve relative cues (today, tomorrow, in N days, next Tuesday) to the user's LOCAL wall-clock time and current year.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
- Each title is a short, polished, grammatical label (no leading filler like "ok" or "so").
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
  // public.check_rate_limit is EXECUTE-granted to service_role only, so it must
  // run via an admin client — the user-scoped client is denied and would make
  // every request look rate-limited (429). Fail loudly if the key is missing:
  // falling back to the anon key would silently reintroduce that 429-everywhere.
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "rate limiter misconfigured" }), { status: 500, headers: { ...corsFor(req), "content-type": "application/json" } });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: allowed, error: rlErr } = await admin.rpc("check_rate_limit", {
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

  // Try each NVIDIA model in MODELS with retries (same policy as parse:
  // per-model 3 attempts with exponential backoff on 429/5xx/network, fall
  // through on persistent failure or 404 model removal; 401/403 stop now).
  async function callNvidia(): Promise<Response> {
    let lastRes: Response | null = null;
    for (const model of MODELS) {
      const body = {
        model,
        messages: [
          { role: "system", content: SYSTEM(tzOffsetMinutes) },
          { role: "user", content: paragraph }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      };
      let delay = 1000;
      let res: Response | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          res = await fetch(NVIDIA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000)
          });
        } catch {
          if (attempt === 3) break;
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30_000);
          continue;
        }
        if (res.ok) return res;
        if (res.status === 401 || res.status === 403) return res;
        if (attempt === 3) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
      if (res) lastRes = res;
    }
    if (lastRes) return lastRes;
    throw new Error("no models available");
  }

  let nvidiaRes: Response;
  try {
    nvidiaRes = await callNvidia();
  } catch {
    return new Response(JSON.stringify({ error: "nvidia unreachable" }), { status: 502, headers: { ...corsFor(req), "content-type": "application/json" } });
  }

  if (!nvidiaRes.ok) {
    const text = await nvidiaRes.text();
    const fwd = nvidiaRes.status === 429 ? 429 : nvidiaRes.status >= 500 ? 502 : nvidiaRes.status;
    return new Response(JSON.stringify({ error: "nvidia error", status: nvidiaRes.status, detail: text }), { status: fwd, headers: { ...corsFor(req), "content-type": "application/json" } });
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
