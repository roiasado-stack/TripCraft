import { localDateString, parseLocalDate } from "./trip-dates";

export const TRIP_TYPES = [
  { value: "family", label: "משפחה", emoji: "👨‍👩‍👧‍👦" },
  { value: "couple", label: "זוג", emoji: "❤️" },
  { value: "friends", label: "חברים", emoji: "🎉" },
  { value: "organized", label: "מאורגן", emoji: "🚌" },
] as const;

export const PREFERENCES = [
  { value: "beach", label: "חוף", emoji: "🏖️" },
  { value: "food", label: "אוכל", emoji: "🍽️" },
  { value: "shopping", label: "קניות", emoji: "🛍️" },
  { value: "history", label: "אתרים היסטוריים", emoji: "🏛️" },
  { value: "nightlife", label: "לילה", emoji: "🌙" },
  { value: "sport", label: "ספורט", emoji: "⚽" },
  { value: "accessibility", label: "נגישות", emoji: "♿" },
  { value: "kosher", label: "כשר", emoji: "✡️" },
  { value: "vegetarian", label: "צמחוני", emoji: "🥗" },
] as const;

export const AGE_RANGES = [
  "0-3",
  "4-8",
  "9-12",
  "13-17",
  "18-29",
  "30-49",
  "50-64",
  "65+",
] as const;

export const BUDGET_LEVELS = [
  { value: "low", label: "חסכוני", emoji: "💰" },
  { value: "mid", label: "מאוזן", emoji: "💳" },
  { value: "high", label: "מפנק", emoji: "💎" },
] as const;

export const DOC_CATEGORIES = [
  { value: "flight", label: "כרטיס טיסה", emoji: "✈️" },
  { value: "hotel", label: "אישור מלון", emoji: "🏨" },
  { value: "insurance", label: "ביטוח", emoji: "🛡️" },
  { value: "passport", label: "דרכון / ויזה", emoji: "🛂" },
  { value: "car", label: "רכב / העברה", emoji: "🚗" },
  { value: "other", label: "אחר", emoji: "📄" },
] as const;

export const SUGGESTION_KINDS = [
  { value: "attraction", label: "אטרקציות", emoji: "🎡" },
  { value: "restaurant", label: "מסעדות", emoji: "🍜" },
  { value: "tip", label: "טיפים מקומיים", emoji: "💡" },
  { value: "gear", label: "ציוד", emoji: "🎒" },
] as const;

export const ITINERARY_CATEGORIES = [
  { value: "activity", label: "פעילות", emoji: "🎯" },
  { value: "food", label: "אוכל", emoji: "🍽️" },
  { value: "transport", label: "תחבורה", emoji: "🚕" },
  { value: "flight", label: "טיסה", emoji: "✈️" },
  { value: "hotel", label: "לינה", emoji: "🏨" },
  { value: "free", label: "זמן חופשי", emoji: "🌊" },
] as const;

export const COVER_EMOJIS = [
  "🌴", "🏖️", "🗼", "🏔️", "🏛️", "🏝️", "🌋", "🕌", "🎡", "🚢", "🏙️", "🌆", "🐫", "🗽",
] as const;

/**
 * Hebrew destination text → flag emoji, checked as a substring against the
 * whole free-text `destination` field. The place the user wrote first wins
 * ("מילאנו … וחזרה דרך מינכן" is Italy), so list order doesn't matter.
 */
const DESTINATION_FLAGS: [string, string][] = [
  ["צ'כיה", "🇨🇿"], ["צ׳כיה", "🇨🇿"], ["פראג", "🇨🇿"],
  ["קרואטיה", "🇭🇷"], ["דוברובניק", "🇭🇷"], ["ספליט", "🇭🇷"],
  ["מונטנגרו", "🇲🇪"],
  ["בולגריה", "🇧🇬"],
  ["רומניה", "🇷🇴"],
  ["הונגריה", "🇭🇺"], ["בודפשט", "🇭🇺"],
  ["אוסטריה", "🇦🇹"], ["וינה", "🇦🇹"],
  ["גרמניה", "🇩🇪"], ["ברלין", "🇩🇪"], ["מינכן", "🇩🇪"],
  ["הולנד", "🇳🇱"], ["אמסטרדם", "🇳🇱"],
  ["שוויץ", "🇨🇭"],
  ["בלגיה", "🇧🇪"],
  ["פורטוגל", "🇵🇹"], ["ליסבון", "🇵🇹"],
  ["ספרד", "🇪🇸"], ["ברצלונה", "🇪🇸"], ["מדריד", "🇪🇸"], ["מיורקה", "🇪🇸"],
  ["צרפת", "🇫🇷"], ["פריז", "🇫🇷"], ["ניס", "🇫🇷"],
  ["אנגליה", "🇬🇧"], ["בריטניה", "🇬🇧"], ["לונדון", "🇬🇧"],
  ["אירלנד", "🇮🇪"], ["דבלין", "🇮🇪"],
  ["איטליה", "🇮🇹"], ["רומא", "🇮🇹"], ["מילאנו", "🇮🇹"], ["ונציה", "🇮🇹"], ["פירנצה", "🇮🇹"], ["סיציליה", "🇮🇹"],
  ["יוון", "🇬🇷"], ["אתונה", "🇬🇷"], ["רודוס", "🇬🇷"], ["כרתים", "🇬🇷"], ["סנטוריני", "🇬🇷"], ["קורפו", "🇬🇷"], ["מיקונוס", "🇬🇷"],
  ["קפריסין", "🇨🇾"], ["לרנקה", "🇨🇾"], ["לימסול", "🇨🇾"], ["איה נאפה", "🇨🇾"],
  ["טורקיה", "🇹🇷"], ["איסטנבול", "🇹🇷"], ["אנטליה", "🇹🇷"],
  ["גאורגיה", "🇬🇪"], ["באטומי", "🇬🇪"], ["טביליסי", "🇬🇪"],
  ["ארמניה", "🇦🇲"], ["ירוואן", "🇦🇲"],
  ["אזרבייג'ן", "🇦🇿"],
  ["פולין", "🇵🇱"], ["קרקוב", "🇵🇱"], ["ורשה", "🇵🇱"],
  ["שוודיה", "🇸🇪"], ["נורווגיה", "🇳🇴"], ["דנמרק", "🇩🇰"], ["פינלנד", "🇫🇮"], ["איסלנד", "🇮🇸"],
  ["מרוקו", "🇲🇦"], ["מרקש", "🇲🇦"],
  ["מצרים", "🇪🇬"], ["שארם", "🇪🇬"], ["סיני", "🇪🇬"],
  ["ירדן", "🇯🇴"], ["עקבה", "🇯🇴"], ["פטרה", "🇯🇴"],
  ["דובאי", "🇦🇪"], ["איחוד האמירויות", "🇦🇪"],
  ["תאילנד", "🇹🇭"], ["בנגקוק", "🇹🇭"], ["פוקט", "🇹🇭"], ["קופנגן", "🇹🇭"],
  ["וייטנאם", "🇻🇳"],
  ["הודו", "🇮🇳"], ["גואה", "🇮🇳"],
  ["סרי לנקה", "🇱🇰"],
  ["אינדונזיה", "🇮🇩"], ["באלי", "🇮🇩"],
  ["יפן", "🇯🇵"], ["טוקיו", "🇯🇵"],
  ["דרום קוריאה", "🇰🇷"],
  ["סין", "🇨🇳"],
  ["ארצות הברית", "🇺🇸"], ["ניו יורק", "🇺🇸"], ["מיאמי", "🇺🇸"], ["לוס אנג'לס", "🇺🇸"], ["פלורידה", "🇺🇸"],
  ["קנדה", "🇨🇦"],
  ["מקסיקו", "🇲🇽"], ["קנקון", "🇲🇽"],
  ["ברזיל", "🇧🇷"],
  ["ארגנטינה", "🇦🇷"],
  ["קובה", "🇨🇺"],
  ["זנזיבר", "🇹🇿"], ["טנזניה", "🇹🇿"],
  ["קניה", "🇰🇪"],
  ["דרום אפריקה", "🇿🇦"],
  ["אוסטרליה", "🇦🇺"],
  ["ניו זילנד", "🇳🇿"],
];

/** Best-effort flag for a free-text destination — null when nothing matches. */
export function destinationFlag(destination: string | null | undefined): string | null {
  const d = (destination ?? "").trim();
  if (!d) return null;
  let best: { at: number; key: string; flag: string } | null = null;
  for (const [key, flag] of DESTINATION_FLAGS) {
    const at = d.indexOf(key);
    if (at < 0) continue;
    // Earliest mention wins; at the same spot the longer key is the more
    // specific one ("סיני" over "סין").
    if (!best || at < best.at || (at === best.at && key.length > best.key.length)) best = { at, key, flag };
  }
  return best?.flag ?? null;
}

/** "🇮🇹" → "IT". Null for anything that isn't a two-letter regional-indicator flag. */
export function flagCountryCode(emoji: string | null | undefined): string | null {
  const points = [...(emoji ?? "").trim()].map((c) => c.codePointAt(0) ?? 0);
  if (points.length !== 2 || points.some((p) => p < 0x1f1e6 || p > 0x1f1ff)) return null;
  return String.fromCharCode(...points.map((p) => p - 0x1f1e6 + 65));
}

export function prefLabel(value: string) {
  return PREFERENCES.find((p) => p.value === value)?.label ?? value;
}

export function prefEmoji(value: string) {
  return PREFERENCES.find((p) => p.value === value)?.emoji ?? "•";
}

export function docCategoryLabel(value: string) {
  return DOC_CATEGORIES.find((d) => d.value === value)?.label ?? value;
}

export function suggestionKindLabel(value: string) {
  return SUGGESTION_KINDS.find((s) => s.value === value)?.label ?? value;
}

export function itineraryCategory(value: string) {
  return ITINERARY_CATEGORIES.find((c) => c.value === value) ?? ITINERARY_CATEGORIES[0];
}

// Date-only strings are the traveller's calendar day — parse them as local
// (see trip-dates), or a phone west of Greenwich shows the day before.
export function formatHeb(date?: string | null) {
  if (!date) return "";
  return (parseLocalDate(date) ?? new Date(date)).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDayHeb(date: string) {
  return (parseLocalDate(date) ?? new Date(date)).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatTimeHeb(value?: string | null) {
  if (!value) return "";
  // value can be an ISO datetime or a HH:MM[:SS] time string
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTimeHeb(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("he-IL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysBetween(start: string, end: string) {
  const out: string[] = [];
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  if (!from || !to) return out;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) out.push(localDateString(d));
  return out;
}

/** Whole days from today until `date` (can be negative). */
export function tripDuration(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const d = daysBetween(start, end);
  return d.length;
}
