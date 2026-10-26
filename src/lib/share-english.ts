import { parseLocalDate } from "@/lib/trip-dates";

/**
 * English for the public share page only (`/share/:slug?lang=en`) — a demo for
 * agencies abroad (plan docs/plans/2026-10-26-english-share-page.md). This is
 * the one exception to "no i18n layer": Hebrew stays inline in the JSX, and a
 * component on that page reads these strings only when the page is English.
 * Don't use it on any other screen without a decision.
 */

/** `?lang=en` (any case) turns the page English; anything else keeps Hebrew. */
export function isEnglishShare(search: string): boolean {
  return new URLSearchParams(search).get("lang")?.toLowerCase() === "en";
}

export const SHARE_EN = {
  pageTitle: "TripCraft · Your trip",
  loading: "Loading trip…",
  notFoundTitle: "This trip isn't available",
  notFoundBody: "The link may be wrong, or sharing was turned off.",
  tripBy: "Your trip by",
  agencyLogo: (name: string | null) => (name ? `${name} logo` : "Agency logo"),
  days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
  flights: "Flights",
  stays: "Where you're staying",
  itinerary: "Itinerary",
  suggestions: "Recommended",
  day: (n: number) => `Day ${n}`,
  builtWith: "Built with",
  guide: "Your guide",
  whatsappTo: (name: string) => `WhatsApp ${name}`,
  map: "Map",
  updates: "Important updates",
  pinned: "Pinned",
  showAllUpdates: (n: number) => `Show all ${n} updates`,
  album: "Shared photo album",
  photoCredit: "Photo source and license (Wikipedia)",
  photoCreditIllustrative: "Illustrative photo, not of the place itself. Source and license",
  illustrative: "Illustrative",
  legal: { terms: "Terms of use", privacy: "Privacy policy", accessibility: "Accessibility", credits: "Credits and licenses" },
} as const;

/** English labels for SUGGESTION_KINDS values (@/lib/trip-options). */
export const SUGGESTION_KINDS_EN: Record<string, string> = {
  attraction: "Attractions",
  restaurant: "Restaurants",
  tip: "Local tips",
  gear: "Gear",
};

// Same rules as the Hebrew formatters in trip-options: a date-only string is
// the traveller's calendar day, parsed as local.
export function formatDateEn(date?: string | null) {
  if (!date) return "";
  return (parseLocalDate(date) ?? new Date(date)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDayEn(date: string) {
  return (parseLocalDate(date) ?? new Date(date)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatDateTimeEn(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
