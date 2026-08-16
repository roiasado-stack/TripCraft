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

export function prefLabel(value: string) {
  return PREFERENCES.find((p) => p.value === value)?.label ?? value;
}

export function prefEmoji(value: string) {
  return PREFERENCES.find((p) => p.value === value)?.emoji ?? "•";
}

export function tripTypeLabel(value: string) {
  return TRIP_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function tripTypeEmoji(value: string) {
  return TRIP_TYPES.find((t) => t.value === value)?.emoji ?? "🌍";
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

export function formatHeb(date?: string | null) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDayHeb(date: string) {
  return new Date(date).toLocaleDateString("he-IL", {
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
  const from = new Date(start);
  const to = new Date(end);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Whole days from today until `date` (can be negative). */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function tripDuration(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const d = daysBetween(start, end);
  return d.length;
}
