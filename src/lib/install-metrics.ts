import { supabase } from "@/lib/supabase";

/*
 * Install metrics (migration 027): once a day per mode, a signed-in user's
 * device type and whether the app is open installed (home screen) or in a tab.
 * Nothing else is sent. The pure helpers at the top are unit-tested.
 */

export type AppPlatform = "ios" | "android" | "desktop" | "other";

/** Device type from the user agent. iPadOS reports itself as a Mac — `maxTouchPoints` tells them apart. */
export function platformFromUserAgent(userAgent: string, maxTouchPoints = 0): AppPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS/.test(userAgent)) return "desktop";
  return "other";
}

/** Opened from the home screen: `display-mode: standalone`, or iOS Safari's `navigator.standalone`. */
export function isStandalone(displayModeStandalone: boolean | undefined, navigatorStandalone: boolean | undefined): boolean {
  return displayModeStandalone === true || navigatorStandalone === true;
}

/** localStorage key that marks "this user already recorded today in this mode" (one browser can hold two accounts). */
export function openKey(userId: string, day: string, standalone: boolean): string {
  return `tripcraft-app-open:${userId}:${day}:${standalone ? "installed" : "browser"}`;
}

/**
 * The day the server records (`current_date` in a UTC database), so the
 * "already recorded" guard and the table agree. A local day would skip the
 * write for a user who opens the app just after local midnight.
 */
export function serverDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Record this open for the signed-in (non-demo) user. Never throws; failures only reach the console. */
export async function recordAppOpen(userId: string): Promise<void> {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = isStandalone(window.matchMedia?.("(display-mode: standalone)").matches, nav.standalone);
    const key = openKey(userId, serverDay(new Date()), standalone);
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // storage blocked: the server ignores a repeat anyway
    }
    const { error } = await supabase.rpc("record_app_open", {
      p_platform: platformFromUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0),
      p_standalone: standalone,
    });
    if (error) {
      console.warn("record_app_open failed", error);
      return;
    }
    try {
      localStorage.setItem(key, "1");
    } catch {
      // storage blocked: nothing to remember
    }
  } catch (e) {
    console.warn("record_app_open failed", e);
  }
}
