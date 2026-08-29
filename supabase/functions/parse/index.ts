// Supabase Edge Function: /functions/v1/parse
// Holds David's NVIDIA key server-side, enforces space-token auth + a global
// rate limit, and forwards natural-language phrases to NVIDIA's NIM endpoint.
// Deployed with: supabase functions deploy parse --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
// NVIDIA's own Nemotron models, in priority order. The free shared tier is prone to
// transient 502/504 and occasional model removal, so we try each in turn — smallest
// fast MoE first, then a larger accurate instruct model, then another small MoE.
// (mistralai/mistral-nemotron was a Mistral model, not NVIDIA's.)
const MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/nemotron-nano-3-30b-a3b"
];

// Rate limiting is durable + per-space, enforced in Postgres via
// public.check_rate_limit (called after the space token is validated).

// The model must anchor "now" to the USER's local clock, not the server's UTC.
// The browser sends its real UTC offset (minutes); we reconstruct the user's
// actual local time here so relative phrases ("in 30 minutes", "Tuesday 3pm")
// resolve to the wall clock the user expects.
function localNow(tzOffsetMinutes: number): Date {
  return new Date(Date.now() + tzOffsetMinutes * 60000);
}

function SYSTEM(tzOffsetMinutes: number): string {
  const now = localNow(tzOffsetMinutes);
  return `Convert a scheduling phrase into JSON. Output ONLY valid JSON with these fields:
- title: short task label (string)
- datetime: the user's LOCAL wall-clock time as ISO 8601 with their LOCAL timezone offset, or null if no specific time
- type: "todo" if no time given, otherwise "event"
- reminder: ISO 8601 time to remind, or null

The user's CURRENT local time RIGHT NOW is: ${now.toString()} (ISO: ${now.toISOString()}). Their local timezone offset from UTC is ${tzOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tzOffsetMinutes)} minutes.

CRITICAL — all times you output are the user's LOCAL wall clock:
- "in the next hour", "within an hour", "in 30 minutes", "in X minutes", "in X hours", "right now", "asap" => take the current LOCAL time (${now.toTimeString().slice(0, 5)}) and ADD the duration. If the sum passes midnight, datetime is still TODAY or just past midnight — NOT tomorrow at 11am.
- Example: if it is 8:37 PM local and the user says "in the next hour", the datetime MUST be about 9:37 PM TODAY local. Never output 11:00 AM or any time on a different day for a relative-now phrase.
- "tonight"/"this evening" => today, 18:00–23:00 local. "morning" => today if before noon, else tomorrow ~9:00. "afternoon" => today if before 12:00, else tomorrow ~14:00.
- "today" => current LOCAL calendar day. "tomorrow" => next LOCAL calendar day.
- Weekday names => the NEXT occurrence of that weekday counting from TODAY local (today does not count unless it is that weekday and the time is still ahead).
- If NO time is mentioned at all => type "todo", datetime null.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
Do not include commentary.`;
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

  let phrase = "";
  let tzOffsetMinutes = 0;
  try {
    const body = await req.json();
    phrase = (body.phrase || "").toString().slice(0, 500);
    const off = Number(body.tzOffsetMinutes);
    if (Number.isFinite(off)) tzOffsetMinutes = off;
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
  if (!phrase) {
    return new Response(JSON.stringify({ error: "empty phrase" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }

  // keep space token alive (optional, ignores errors)
  try {
    await supabase.from("spaces").update({ last_active_at: new Date().toISOString() }).eq("token", spaceId);
  } catch { /* non-fatal */ }

  // Try each NVIDIA model in MODELS. Per model we retry on 429 / 5xx / network errors
  // with exponential backoff (NVIDIA's free tier sends NO Retry-After header, so we
  // back off ourselves: 1s→2s→4s, cap 30s). If a model stays unhealthy (or 404s, i.e.
  // it was removed from the catalog), we fall through to the next model. 401/403 are
  // key/auth errors shared by all models, so we surface those immediately.
  async function callNvidia(): Promise<Response> {
    let lastRes: Response | null = null;
    for (const model of MODELS) {
      const body = {
        model,
        messages: [
          { role: "system", content: SYSTEM(tzOffsetMinutes) },
          { role: "user", content: phrase }
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
        } catch (e) {
          if (attempt === 3) break;
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30_000);
          continue;
        }
        if (res.ok) return res;
        // 401/403 = auth/key problem — same for every model, stop here.
        if (res.status === 401 || res.status === 403) return res;
        // 429 / 5xx / 404 = retryable or model removed → fall back to next model after attempts.
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
    return new Response(JSON.stringify({ error: "nvidia unreachable" }), { status: 502, headers: { ...cors, "content-type": "application/json" } });
  }

  if (!nvidiaRes.ok) {
    const text = await nvidiaRes.text();
    // Preserve NVIDIA's REAL status so the client can tell 429 (throttle) from 502/504 (retryable infra).
    const fwd = nvidiaRes.status === 429 ? 429 : nvidiaRes.status >= 500 ? 502 : nvidiaRes.status;
    return new Response(JSON.stringify({ error: "nvidia error", status: nvidiaRes.status, detail: text }), { status: fwd, headers: { ...cors, "content-type": "application/json" } });
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
