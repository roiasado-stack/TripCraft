import { supabase } from "@/lib/supabase";

/*
 * Web push on this device (migration 026, notify Edge Function).
 * public/sw.js only receives pushes — it has no fetch handler and caches nothing.
 * The pure helpers at the top are unit-tested; the rest talks to the browser.
 */

/** The server's VAPID public key; push is unavailable without it. */
export const VAPID_PUBLIC_KEY: string = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

export type PushSupport = "supported" | "ios-needs-home-screen" | "unsupported";

/** A base64url string (the VAPID key format) as the bytes PushManager wants. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Whether this device can get pushes. iOS Safari only offers push to a web app
 * added to the home screen (16.4+), so a Safari tab gets instructions instead.
 */
export function pushSupport(env: {
  hasSW: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  isStandalone: boolean;
}): PushSupport {
  if (env.isIOS && !env.isStandalone) return "ios-needs-home-screen";
  if (env.hasSW && env.hasPushManager && env.hasNotification) return "supported";
  return "unsupported";
}

/** iPhone/iPod/iPad — including iPadOS, which reports itself as a Mac with touch. */
export function isIOSDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    hasSW: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIOS: isIOSDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    isStandalone: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
  });
}

export function notificationPermission(): NotificationPermission | "unavailable" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unavailable";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // register() is idempotent; ready waits for a worker that is still installing, or subscribe() throws.
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function browserSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Saves this device for the signed-in user. Not a plain upsert: an endpoint is
 * per browser profile, so on a shared device the row may still belong to the
 * previous account (invisible under RLS, and UNIQUE). claim_push_subscription
 * (SECURITY DEFINER) upserts by endpoint and hands the row to the caller.
 */
async function claimRow(sub: PushSubscription) {
  const json = sub.toJSON();
  return supabase.rpc("claim_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent.slice(0, 400),
  });
}

/**
 * Whose is this browser's push subscription? "other" = a row exists that the
 * signed-in user can't see (RLS: own rows only), i.e. a previous account's;
 * "unknown" when the lookup itself failed — never act on that.
 */
async function deviceOwner(sub: PushSubscription): Promise<"mine" | "other" | "unknown"> {
  const { data, error } = await supabase.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
  if (error) return "unknown";
  return data ? "mine" : "other";
}

/**
 * On sign-in (not a demo user): a push subscription this browser still holds
 * for someone else — a previous account whose sign-out cleanup didn't finish,
 * or whose session ended without one — is dropped, never claimed. The new user
 * turns notifications on themselves. Browser-only; best effort, silent.
 */
export async function releaseForeignSubscription(): Promise<void> {
  try {
    const sub = await browserSubscription();
    if (sub && (await deviceOwner(sub)) === "other") await sub.unsubscribe();
  } catch {
    // Nothing to do — Settings still shows this device's real state.
  }
}

/**
 * The session ended without our sign-out (token expired or revoked, signed out
 * in another tab): stop this browser getting the account's pushes. No session
 * is needed — the row is left for notify to delete when the push service
 * reports the endpoint gone (404/410). Best effort, silent.
 */
export async function dropBrowserSubscription(): Promise<void> {
  try {
    const sub = await browserSubscription();
    await sub?.unsubscribe();
  } catch {
    // Ignore.
  }
}

/** This device is subscribed in the browser and the row belongs to the signed-in user. */
export async function isSubscribedHere(): Promise<boolean> {
  const sub = await browserSubscription();
  if (!sub) return false;
  // RLS returns own rows only: another account's row on this browser reads as "off".
  return (await deviceOwner(sub)) === "mine";
}

export type SubscribeResult = "ok" | "no-key" | "denied" | "dismissed" | "unsupported" | "error";

export async function subscribe(): Promise<SubscribeResult> {
  if (!VAPID_PUBLIC_KEY) return "no-key";
  if (detectPushSupport() !== "supported") return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied") return "denied";
    if (permission !== "granted") return "dismissed";
    const reg = await registration();
    if (!reg) return "unsupported";
    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const { error } = await claimRow(sub);
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}

/** Turns push off on this device: the row first (so nothing is sent), then the browser. */
export async function unsubscribe(): Promise<boolean> {
  const sub = await browserSubscription();
  if (!sub) return true;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  return !error;
}

/**
 * Sign-out on a shared browser: the next account must not get the previous
 * one's pushes. Best effort and time-boxed — never holds up the sign-out.
 */
export async function unsubscribeOnSignOut(timeoutMs = 3000): Promise<void> {
  // A failure leaves a row the next subscribe() on this browser replaces, or
  // that notify deletes on the push service's 404/410.
  await Promise.race([unsubscribe().catch(() => false), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
