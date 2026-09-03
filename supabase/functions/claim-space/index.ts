import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return new Response("missing bearer token", { status: 401 });
  const jwt = m[1];

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return new Response("invalid token", { status: 401 });
  const userId = userData.user.id;

  let body: { token?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const token = (body.token ?? "").trim();
  if (!token) return new Response("missing token", { status: 400 });

  const dot = token.indexOf(".");
  const id = dot === -1 ? token : token.slice(0, dot);
  const secret = dot === -1 ? "" : token.slice(dot + 1);
  if (!secret) return new Response("token must include secret", { status: 400 });

  // Verify the secret against the spaces table. Use a service-role client
  // because the RLS for `spaces` was removed in the migration; we still want
  // a server-side check, not a client-side trust.
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false }
  });
  const { data: space, error: spaceErr } = await admin
    .from("spaces")
    .select("token, secret")
    .eq("token", id)
    .maybeSingle();
  if (spaceErr) return new Response(`db error: ${spaceErr.message}`, { status: 500 });
  if (!space) return new Response("unknown token", { status: 404 });
  if (space.secret !== secret) return new Response("bad secret", { status: 403 });

  const { data, error } = await admin
    .from("items")
    .update({ user_id: userId })
    .eq("space_token", id)
    .select("id");
  if (error) return new Response(`update failed: ${error.message}`, { status: 500 });

  await admin.from("spaces").delete().eq("token", id);

  return new Response(JSON.stringify({ ok: true, count: (data ?? []).length }), {
    headers: { "content-type": "application/json" }
  });
});
