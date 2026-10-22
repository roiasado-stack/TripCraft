/**
 * notify — web push notifications (Supabase Edge Function, Deno).
 *
 * Two callers:
 *   1. The database (migration 026). The triggers on trip_updates and
 *      trip_members call this through pg_net with the shared secret in
 *      `x-notify-secret` and a body of `{ type: "update" | "join", id }`.
 *      Who gets the push is decided in SQL by push_recipients_for_update /
 *      push_recipients_for_join (service role only, covered by
 *      supabase/tests/09_web_push.sql) — this file never widens that list.
 *   2. A signed-in user, `{ type: "test" }` with their JWT: a test push to
 *      their own devices only. Demo (anonymous) users are refused.
 *
 * The payload is `{ title, body, url }` (Hebrew). Web push encrypts it end to
 * end, so the push services (Google, Apple, Mozilla, Microsoft) can't read it.
 * A device whose push service answers 404/410 is gone: its row is deleted.
 *
 * Deploy (the database calls it without a JWT, hence --no-verify-jwt; the
 * secret / the user's JWT are checked here instead):
 *   supabase functions deploy notify --no-verify-jwt
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
 *   supabase secrets set NOTIFY_SECRET=<the same value as the Vault secret 'notify_secret'>
 * Keys: `npx web-push generate-vapid-keys` (the public key also goes to the client).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** A day: an update that arrives later than that is no longer news. */
const TTL_SECONDS = 24 * 60 * 60;
const MAX_BODY = 180;

type Payload = { title: string; body: string; url: string };
type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function clip(s: string, max = MAX_BODY): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Constant-time comparison of the shared secret. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function updatePayload(admin: SupabaseClient, updateId: string): Promise<Payload | null> {
  const { data } = await admin
    .from("trip_updates")
    .select("title, trip_id, trips(title)")
    .eq("id", updateId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { title: string; trip_id: string; trips: { title: string } | null };
  return {
    title: clip(row.trips?.title || "TripCraft", 80),
    body: clip(`עדכון חדש: ${row.title}`),
    url: `/trip/${row.trip_id}`,
  };
}

async function joinPayload(admin: SupabaseClient, memberId: string): Promise<Payload | null> {
  const { data } = await admin
    .from("trip_members")
    .select("display_name, trip_id, trips(title)")
    .eq("id", memberId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { display_name: string | null; trip_id: string; trips: { title: string } | null };
  const who = row.display_name?.trim() || "מישהו";
  return {
    title: "בקשת הצטרפות חדשה",
    body: clip(`${who} רוצה להצטרף לטיול "${row.trips?.title ?? ""}". אפשר לאשר במסך המשתתפים.`),
    // The members screen is the share sheet inside the trip; ?members=1 opens it (client, phase 2).
    url: `/trip/${row.trip_id}?members=1`,
  };
}

async function recipients(admin: SupabaseClient, type: "update" | "join", id: string): Promise<string[]> {
  const fn = type === "update" ? "push_recipients_for_update" : "push_recipients_for_join";
  const arg = type === "update" ? { p_update_id: id } : { p_member_id: id };
  const { data, error } = await admin.rpc(fn, arg);
  if (error) throw new Error(`${fn}: ${error.message}`);
  // SETOF uuid comes back as an array of strings.
  return (data as string[] | null) ?? [];
}

async function send(admin: SupabaseClient, subs: Subscription[], payload: Payload) {
  const text = JSON.stringify(payload);
  const ok: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          text,
          { TTL: TTL_SECONDS },
        );
        ok.push(s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        else {
          failed++;
          console.error("push failed", status ?? "", (e as Error).message);
        }
      }
    }),
  );
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (ok.length) await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", ok);
  return { sent: ok.length, removed: gone.length, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const secret = Deno.env.get("NOTIFY_SECRET");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !serviceKey || !anonKey || !secret || !vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error("notify: missing secret(s)");
    return json(500, { error: "not_configured" });
  }

  let body: { type?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  const type = body.type;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    // A signed-in user's test push: their own devices, nobody else's.
    if (type === "test") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json(401, { error: "unauthorized" });
      const asUser = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: auth } = await asUser.auth.getUser();
      const user = auth?.user;
      if (!user) return json(401, { error: "unauthorized" });
      if (user.is_anonymous) return json(403, { error: "anonymous_not_allowed" });
      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", user.id);
      const list = (subs as Subscription[] | null) ?? [];
      if (!list.length) return json(200, { ok: true, sent: 0, removed: 0, failed: 0, no_devices: true });
      const result = await send(admin, list, {
        title: "TripCraft",
        body: "התראת ניסיון: ההתראות פועלות במכשיר הזה",
        url: "/settings",
      });
      return json(200, { ok: true, ...result });
    }

    // From the database: the shared secret, or nothing happens.
    if (!(await sameSecret(req.headers.get("x-notify-secret") ?? "", secret))) {
      return json(401, { error: "unauthorized" });
    }
    if ((type !== "update" && type !== "join") || typeof body.id !== "string") {
      return json(400, { error: "bad_request" });
    }

    const userIds = await recipients(admin, type, body.id);
    if (!userIds.length) return json(200, { ok: true, sent: 0, removed: 0, failed: 0 });
    const payload = type === "update" ? await updatePayload(admin, body.id) : await joinPayload(admin, body.id);
    if (!payload) return json(200, { ok: true, sent: 0, removed: 0, failed: 0 });

    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds);
    if (error) throw new Error(error.message);
    const result = await send(admin, (subs as Subscription[] | null) ?? [], payload);
    return json(200, { ok: true, ...result });
  } catch (e) {
    console.error("notify error", (e as Error).message);
    return json(500, { error: "internal" });
  }
});
