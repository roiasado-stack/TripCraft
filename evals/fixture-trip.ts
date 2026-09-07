import type { Participant } from "../supabase/functions/ask/prompt.ts";

/**
 * Static twin of the "חופשה משפחתית ברודוס" demo trip created by
 * src/lib/demo-trip.ts — same family, same itinerary, same suggestion
 * titles, but with fixed dates (instead of "24 days from today") so eval
 * runs are reproducible. Fields are limited to exactly what
 * `buildSnapshot()` reads: it does NOT see itinerary descriptions/locations,
 * suggestion descriptions/tags/price/liked-status, transfers, documents, or
 * trip_updates — questions in questions.jsonl are written against that real
 * boundary, not against everything the demo trip happens to contain.
 */

export const FIXTURE_TRIP = {
  destination: "רודוס, יוון",
  trip_type: "family",
  budget_level: "mid",
  start_date: "2026-10-01",
  end_date: "2026-10-06",
  notes: "טיול לדוגמה — אפשר לערוך או למחוק הכל.",
};

export const FIXTURE_PARTICIPANTS: Participant[] = [
  { name: "דני כהן", age: 41, age_range: null, preferences: ["food", "history", "sport"] },
  { name: "מיכל כהן", age: 39, age_range: null, preferences: ["beach", "shopping", "food"] },
  { name: "יעל כהן", age: 8, age_range: null, preferences: ["beach", "food"] },
  { name: "איתי כהן", age: 3, age_range: null, preferences: ["beach"] },
];

export const FIXTURE_STAYS = [
  {
    hotel_name: "Rodos Palace Resort",
    address: "Iraklidon Ave, Ialysos, Rhodes",
    check_in: "2026-10-01",
    check_out: "2026-10-06",
  },
];

export const FIXTURE_FLIGHTS = [
  { direction: "outbound", from_airport: "TLV", to_airport: "RHO", depart_at: "2026-10-01T06:40:00.000Z" },
  { direction: "inbound", from_airport: "RHO", to_airport: "TLV", depart_at: "2026-10-06T20:10:00.000Z" },
];

export const FIXTURE_ITINERARY = [
  { day_date: "2026-10-01", start_time: "06:40", title: "טיסה לרודוס" },
  { day_date: "2026-10-01", start_time: "10:00", title: "איסוף רכב שכור" },
  { day_date: "2026-10-01", start_time: "14:00", title: "צ'ק אין ומנוחה בבריכה" },
  { day_date: "2026-10-02", start_time: "09:30", title: "העיר העתיקה של רודוס" },
  { day_date: "2026-10-02", start_time: "13:00", title: "ארוחת צהריים ב-Marco Polo" },
  { day_date: "2026-10-03", start_time: "10:00", title: "חוף צרפתי (Faliraki)" },
  { day_date: "2026-10-03", start_time: "17:00", title: "זמן חופשי / קניות" },
  { day_date: "2026-10-04", start_time: "09:00", title: "עמק הפרפרים" },
  { day_date: "2026-10-05", start_time: "11:00", title: "לינדוס והאקרופוליס" },
  { day_date: "2026-10-06", start_time: "20:10", title: "טיסה חזרה לישראל" },
];

// Titles only — buildSnapshot() drops kind/description/tags/price/liked.
export const FIXTURE_SUGGESTIONS = [
  { title: "האקרופוליס של לינדוס" },
  { title: "עמק הפרפרים" },
  { title: "אקווריום רודוס" },
  { title: "מפרץ אנתוני קווין" },
  { title: "Marco Polo Mansion" },
  { title: "Tamam" },
  { title: "To Steno" },
  { title: "שכירת רכב משתלמת" },
  { title: "שעות החום" },
  { title: "נעלי ים" },
];

// Matches demo-trip.ts: 2 checklist items done, 8 open.
export const FIXTURE_CHECKLIST_OPEN = 8;
