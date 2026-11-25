/**
 * demo-request — the agent demo form on /agents (Supabase Edge Function, Deno).
 *
 * A logged-out visitor posts { full_name, agency_name, phone, email, trips_per_month, website }.
 * The function validates, stores the lead in `demo_requests` (migration 031; service role only),
 * then sends two emails through Resend:
 *   1. to the agent: the demo video link and the call-booking link,
 *   2. to the business inbox: who asked.
 * Emails are best-effort: the lead is saved first, and a failed email never fails the request.
 *
 * Abuse: `website` is a honeypot (bots fill it; we answer ok and store nothing). An address that
 * already asked in the last 24 hours is stored but not emailed again, and no more than 30 leads
 * per hour are accepted in total, so the form can't be used to mail-bomb a third party.
 *
 * Deploy:
 *   supabase functions deploy demo-request
 *   supabase secrets set RESEND_API_KEY=... MAIL_FROM="TripCraft <hello@tripcraft.co.il>" \
 *     DEMO_NOTIFY_EMAIL=... DEMO_VIDEO_URL=... [DEMO_BOOKING_URL=...] [DEMO_REPLY_TO=...]
 * Without RESEND_API_KEY the leads are still saved, and nothing is sent.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRIPS = ["up_to_10", "10_30", "30_plus"] as const;
const TRIPS_LABEL: Record<(typeof TRIPS)[number], string> = {
  up_to_10: "עד 10",
  "10_30": "10-30",
  "30_plus": "30+",
};
const HOURLY_CAP = 30;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Only an http(s) link may go into an email. */
function safeUrl(v: string | undefined): string {
  try {
    const u = new URL((v ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

async function sendMail(key: string, from: string, to: string, subject: string, html: string, text: string) {
  // Replies go to DEMO_REPLY_TO when set (e.g. a Gmail address until hello@ receives mail).
  const replyTo = (Deno.env.get("DEMO_REPLY_TO") ?? "").trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(500, { error: "not_configured" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }

  // Honeypot: a real visitor never sees this field.
  if (str(body.website, 200) !== "") return json(200, { ok: true });

  const fullName = str(body.full_name, 100);
  const agencyName = str(body.agency_name, 120);
  const phone = str(body.phone, 30);
  const email = str(body.email, 254).toLowerCase();
  const trips = str(body.trips_per_month, 20) as (typeof TRIPS)[number];
  if (
    fullName.length < 2 || agencyName.length < 2 || phone.length < 7 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !TRIPS.includes(trips)
  ) {
    return json(400, { error: "invalid" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: lastHour } = await admin
    .from("demo_requests").select("id", { count: "exact", head: true }).gte("created_at", hourAgo);
  if ((lastHour ?? 0) >= HOURLY_CAP) return json(429, { error: "busy" });

  const { count: sameEmail } = await admin
    .from("demo_requests").select("id", { count: "exact", head: true }).ilike("email", email).gte("created_at", dayAgo);
  const alreadyMailed = (sameEmail ?? 0) > 0;

  const { data: row, error } = await admin
    .from("demo_requests")
    .insert({ full_name: fullName, agency_name: agencyName, phone, email, trips_per_month: trips })
    .select("id")
    .single();
  if (error || !row) {
    console.error("demo-request insert", error?.message);
    return json(500, { error: "internal" });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (resendKey && from) {
    const videoUrl = safeUrl(Deno.env.get("DEMO_VIDEO_URL"));
    const bookingUrl = safeUrl(Deno.env.get("DEMO_BOOKING_URL"));
    const notifyTo = Deno.env.get("DEMO_NOTIFY_EMAIL");
    const now = new Date().toISOString();

    if (!alreadyMailed && (videoUrl || bookingUrl)) {
      try {
        const lines = [`שלום ${fullName},`, "תודה שפניתם ל-TripCraft."];
        if (videoUrl) lines.push(`סרטון ההדגמה: ${videoUrl}`);
        if (bookingUrl) lines.push(`לקביעת שיחה: ${bookingUrl}`);
        const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7">${
          lines.map((l) => `<p>${esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).join("")
        }</div>`;
        await sendMail(resendKey, from, email, "הדגמה של TripCraft", html, lines.join("\n"));
        await admin.from("demo_requests").update({ agent_emailed_at: now }).eq("id", row.id);
      } catch (e) {
        console.error("demo-request agent email", (e as Error).message);
      }
    }

    if (notifyTo) {
      try {
        const lines = [
          "בקשת הדגמה חדשה מדף הסוכנים",
          `שם: ${fullName}`,
          `סוכנות: ${agencyName}`,
          `טלפון: ${phone}`,
          `מייל: ${email}`,
          `טיולים בחודש: ${TRIPS_LABEL[trips]}`,
        ];
        const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7">${
          lines.map((l) => `<p>${esc(l)}</p>`).join("")
        }</div>`;
        await sendMail(resendKey, from, notifyTo, `בקשת הדגמה: ${agencyName}`, html, lines.join("\n"));
        await admin.from("demo_requests").update({ team_notified_at: now }).eq("id", row.id);
      } catch (e) {
        console.error("demo-request notify", (e as Error).message);
      }
    }
  }

  return json(200, { ok: true });
});
