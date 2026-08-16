import type { Participant, Trip } from "./types";

/**
 * Deterministic, offline "smart starter" checklist — genuinely useful value
 * without needing the LLM. Tailored to participants (kids/babies), trip type,
 * duration and preferences.
 */
export function starterChecklist(trip: Trip, participants: Participant[]): string[] {
  const items = new Set<string>();
  const base = [
    "דרכונים בתוקף (6+ חודשים)",
    "כרטיסי טיסה / אישורי הזמנה",
    "ביטוח נסיעות",
    "מטען וכבלים לטלפון",
    "מתאם חשמל בינלאומי",
    "כסף מזומן + כרטיס אשראי",
    "תרופות אישיות",
    "משקפי שמש וקרם הגנה",
  ];
  base.forEach((i) => items.add(i));

  const ages = participants.map((p) => p.age ?? ageFromRange(p.age_range)).filter((n): n is number => n != null);
  const hasBaby = ages.some((a) => a <= 3);
  const hasKid = ages.some((a) => a > 3 && a <= 12);

  if (hasBaby) {
    ["חיתולים ומגבונים", "אוכל/תחליף לתינוק", "עגלה או מנשא", "בגדים להחלפה בשפע"].forEach((i) => items.add(i));
  }
  if (hasKid) {
    ["צעצועים / פעילות לילדים", "חטיפים לדרך", "בגדי החלפה לילדים"].forEach((i) => items.add(i));
  }

  const prefs = new Set(participants.flatMap((p) => p.preferences));
  if (prefs.has("beach")) ["בגדי ים", "מגבת חוף", "כפכפים"].forEach((i) => items.add(i));
  if (prefs.has("sport")) ["נעלי ספורט", "בגדי אימון"].forEach((i) => items.add(i));
  if (prefs.has("history")) items.add("נעליים נוחות להליכה");
  if (prefs.has("nightlife")) items.add("בגדים לערב");
  if (prefs.has("accessibility")) items.add("ציוד נגישות / עזרים");

  if (trip.trip_type === "family") items.add("ערכת עזרה ראשונה");

  return [...items];
}

function ageFromRange(range?: string | null): number | null {
  if (!range) return null;
  const m = range.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}
