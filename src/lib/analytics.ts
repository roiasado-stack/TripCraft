/*
 * Google Analytics 4 + Meta Pixel, and the handful of events the landing funnel needs.
 *
 * Privacy rules (CLAUDE.md: a new data flow to a third party must be on /privacy):
 *  - Nothing loads unless VITE_GA_ID / VITE_META_PIXEL_ID are set, so dev and tests send nothing.
 *  - The trackers run ONLY on the screens listed in `trackablePath`: the public landing page, the
 *    agents page, the new-trip wizard and the "trip created" screen. A URL that carries anything
 *    secret (an auth code or token, an invite or share link, a trip id) is never trackable, and
 *    when the user moves off a trackable screen the trackers are switched off again.
 *  - Events carry only a name and a coarse label (where the button was). Never a name, email,
 *    trip title or any trip content.
 *  - Do Not Track / Global Privacy Control turn everything off.
 */

const GA_ID = (import.meta.env.VITE_GA_ID ?? "").trim();
const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID ?? "").trim();

/** True when at least one tracker is configured — /privacy only mentions them then. */
export const ANALYTICS_ENABLED = GA_ID !== "" || PIXEL_ID !== "";

export type AnalyticsEvent =
  | "click_create_trip"
  | "click_agent_demo"
  | "submit_agent_demo"
  | "click_upload_booking"
  | "toggle_audience_agent"
  | "toggle_audience_traveler"
  | "trip_created";

type Params = Record<string, string | number | boolean>;

const SAFE_HASHES = new Set(["", "#demo", "#example", "#features"]);

/**
 * The page path a tracker may report for this location, or null when the trackers must stay off.
 * Only these screens qualify, with no query except `?audience=` and no unknown hash.
 */
export function trackablePath(loc: { pathname: string; search: string; hash: string }): string | null {
  if (!SAFE_HASHES.has(loc.hash)) return null;
  for (const key of new URLSearchParams(loc.search).keys()) if (key !== "audience") return null;
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/agents" || path === "/new") return path;
  if (/^\/trip\/[0-9a-f-]{36}\/created$/i.test(path)) return "/trip/created";
  return null;
}

/** Browser-level "don't track me" signals. */
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

interface Fbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: unknown;
  disablePushState?: boolean;
}
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: Fbq;
  _fbq?: Fbq;
} & Record<string, unknown>;

let started = false;

function loadScript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function startGa(path: string) {
  const w = window as unknown as AnalyticsWindow;
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js only understands the `arguments` object, not an array.
  w.gtag = function gtag() {
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  // The automatic page_view would report the raw URL; send our own, sanitized one.
  w.gtag("config", GA_ID, { send_page_view: false });
  w.gtag("event", "page_view", { page_location: `${location.origin}${path}`, page_path: path });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`);
}

function startPixel() {
  const w = window as unknown as AnalyticsWindow;
  if (!w.fbq) {
    // Meta's standard loader snippet, typed: queue calls until fbevents.js replaces callMethod.
    const stub = function () {
      const f = w.fbq as Fbq;
      if (f.callMethod) f.callMethod(...(arguments as unknown as unknown[]));
      else f.queue.push(arguments);
    } as Fbq;
    stub.push = stub;
    stub.loaded = true;
    stub.version = "2.0";
    stub.queue = [];
    w.fbq = stub;
    w._fbq = stub;
  }
  // Without this the pixel reports a PageView, with the raw URL, on every route change.
  w.fbq.disablePushState = true;
  w.fbq("init", PIXEL_ID);
  w.fbq("track", "PageView");
  loadScript("https://connect.facebook.net/en_US/fbevents.js");
}

/** Switch the trackers on or off without unloading them (GA's documented opt-out flag; Meta consent). */
function setActive(on: boolean) {
  const w = window as unknown as AnalyticsWindow;
  if (GA_ID) w[`ga-disable-${GA_ID}`] = !on;
  if (PIXEL_ID && w.fbq) w.fbq("consent", on ? "grant" : "revoke");
}

/**
 * Call on every route change. Starts the trackers the first time a trackable screen is shown,
 * and turns them off whenever the user is somewhere that is not.
 */
export function syncAnalytics(loc: { pathname: string; search: string; hash: string }, signedIn: boolean): void {
  if (!ANALYTICS_ENABLED) return;
  let path = trackablePath(loc);
  // "/" is the landing page for a visitor but the trip list for a signed-in user.
  if (path === "/" && signedIn) path = null;
  if (path === null || optedOut()) {
    if (started) setActive(false);
    return;
  }
  if (!started) {
    started = true;
    if (GA_ID) startGa(path);
    if (PIXEL_ID) startPixel();
  }
  setActive(true);
}

/** Report an event. A no-op while the trackers are off (not configured, opted out, or on another screen). */
export function track(event: AnalyticsEvent, params: Params = {}): void {
  if (!started) return;
  const w = window as unknown as AnalyticsWindow;
  if (GA_ID && w[`ga-disable-${GA_ID}`] !== true) w.gtag?.("event", event, params);
  if (PIXEL_ID) w.fbq?.("trackCustom", event, params);
}
