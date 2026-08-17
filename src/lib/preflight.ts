/**
 * Pre-flight checklist — the "before you leave the house" list, separate from
 * the packing list. Generated locally from the trip's own data so it stays
 * accurate without any AI call.
 */

import type { Flight, Participant, Trip } from "./types";

export type PreflightItem = { title: string; hours_before: number };

/** Ordered from earliest to latest relative to departure. */
export function preflightChecklist(
  trip: Trip,
  flights: Flight[],
  participants: Participant[],
): PreflightItem[] {
  const out: PreflightItem[] = [];
  const add = (title: string, hours_before: number) => out.push({ title, hours_before });

  const outbound = flights.find((f) => f.direction === "outbound") ?? flights[0];
  const hasKids = participants.some((p) => (p.age ?? 99) <= 12);
  const hasBaby = participants.some((p) => (p.age ?? 99) <= 3);
  const needsAccess = participants.some((p) => p.preferences?.includes("accessibility"));
  const kosher = participants.some((p) => p.preferences?.includes("kosher"));
  const vegetarian = participants.some((p) => p.preferences?.includes("vegetarian"));

  // A week out
  add("לוודא שהדרכונים בתוקף (6+ חודשים)", 168);
  add("לבדוק אם נדרשת ויזה / ETA ליעד", 168);
  if (kosher || vegetarian) add("להזמין ארוחה מיוחדת בטיסה (כשר / צמחוני)", 168);
  if (needsAccess) add("לתאם סיוע נגישות מול חברת התעופה", 168);
  if (hasBaby) add("לאשר מול חברת התעופה עריסה / מושב תינוק", 168);

  // Two days out
  add("לרכוש ביטוח נסיעות ולשמור את הפוליסה", 48);
  add("להוריד את המסמכים לטלפון (זמינים גם בלי אינטרנט)", 48);
  add("להזמין העברה / להסדיר חניה לשדה", 48);
  add("לבדוק תחזית מזג אוויר ולהתאים את המזוודה", 48);

  // Day before
  add("צ'ק-אין אונליין והורדת כרטיסי עלייה למטוס", 24);
  add("לשקול את המזוודות ולוודא עמידה במשקל המותר", 24);
  add("להטעין טלפונים, אוזניות ומטען נייד", 24);
  add("להמיר מזומן / לעדכן את חברת האשראי על נסיעה", 24);
  if (hasKids) add("להכין תיק יד לילדים: חטיפים, פעילות, בגד להחלפה", 24);
  add("לוודא שאין נוזלים מעל 100 מ\"ל בכבודת היד", 24);

  // Departure day
  const airport = outbound?.from_airport?.trim();
  add(`לצאת לשדה${airport ? ` (${airport})` : ""} — 3 שעות לפני להמראה בינלאומית`, 4);
  add("לבדוק סטטוס טיסה לפני היציאה מהבית", 4);
  add("דרכונים, ארנק, מפתחות, טלפון — בדיקה אחרונה", 3);
  add("לכבות מים/גז ולנעול את הבית", 3);

  return out;
}

export function hoursLabel(h: number): string {
  if (h >= 168) return "שבוע לפני";
  if (h >= 48) return "יומיים לפני";
  if (h >= 24) return "יום לפני";
  return "ביום הטיסה";
}
