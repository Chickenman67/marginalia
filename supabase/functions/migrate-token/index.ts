// Supabase Edge Function: /functions/v1/migrate-token
// Re-keys a legacy space (token prefixed "space-") to a new id.secret pair.
// The legacy token itself is the proof of ownership; no JWT required.
// Deployed with: supabase functions deploy migrate-token --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const oldToken = String(body.oldToken ?? "");
  const newId = String(body.newId ?? "");
  const newSecret = String(body.newSecret ?? "");

  if (!oldToken.startsWith("space-") || !newId || !newSecret) {
    return new Response(JSON.stringify({ ok: false, error: "bad input" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }

  const { data, error } = await supabase.rpc("migrate_legacy_token", { old_token: oldToken, new_id: newId, new_secret: newSecret });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
  if (data === false) {
    return new Response(JSON.stringify({ ok: false, error: "no legacy space matched" }), { status: 200, headers: { ...cors, "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
});
