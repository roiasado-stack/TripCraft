import { supabase } from "./supabase";
import { mapsUrl } from "./maps";

/**
 * Creates a fully populated example trip so every screen can be reviewed with
 * realistic content. Uses only local data — no AI. Dates are relative to today
 * so the countdown always reads sensibly.
 *
 * Two rules matter here and are easy to get wrong:
 *  1. PostgREST rejects a bulk insert unless EVERY row has identical keys
 *     (PGRST102). Each builder below therefore emits a fixed shape, with
 *     explicit nulls rather than omitted fields.
 *  2. supabase-js returns errors instead of throwing, so every insert is
 *     checked — otherwise a failure is silent and the screen just looks empty.
 */

type Row = Record<string, unknown>;

async function insertAll(table: string, rows: Row[]) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
}

export async function createDemoTrip(userId: string): Promise<string> {
  const start = new Date();
  start.setDate(start.getDate() + 24);
  const end = new Date(start);
  end.setDate(end.getDate() + 5);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const dayN = (n: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const at = (dayOffset: number, time: string) => {
    const d = new Date(start);
    d.setDate(d.getDate() + dayOffset);
    const [h, m] = time.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .insert({
      user_id: userId,
      title: "חופשה משפחתית ברודוס (דוגמה)",
      destination: "רודוס, יוון",
      start_date: iso(start),
      end_date: iso(end),
      trip_type: "family",
      budget_level: "mid",
      cover_emoji: "🏝️",
      notes: "טיול לדוגמה — אפשר לערוך או למחוק הכל.",
      photos_album_url: "https://photos.app.goo.gl/example-shared-album",
    })
    .select()
    .single();
  if (tripErr || !trip) throw new Error(`trips: ${tripErr?.message ?? "insert failed"}`);
  const tripId = (trip as { id: string }).id;

  const person = (name: string, age: number, preferences: string[]): Row => ({
    trip_id: tripId,
    name,
    age,
    age_range: null,
    preferences,
    notes: null,
  });

  const { data: people, error: peopleErr } = await supabase
    .from("participants")
    .insert([
      person("דני כהן", 41, ["food", "history", "sport"]),
      person("מיכל כהן", 39, ["beach", "shopping", "food"]),
      person("יעל כהן", 8, ["beach", "food"]),
      person("איתי כהן", 3, ["beach"]),
    ])
    .select();
  if (peopleErr) throw new Error(`participants: ${peopleErr.message}`);

  const id = ((people as { id: string; name: string }[]) ?? []).reduce<Record<string, string>>(
    (acc, p) => {
      acc[p.name] = p.id;
      return acc;
    },
    {},
  );

  const flight = (
    direction: string,
    flight_number: string,
    from_airport: string,
    to_airport: string,
    depart_at: string,
    arrive_at: string,
    from_terminal: string,
    to_terminal: string,
  ): Row => ({
    trip_id: tripId,
    direction,
    airline: "אל על",
    flight_number,
    from_airport,
    to_airport,
    depart_at,
    arrive_at,
    booking_ref: "ABC123",
    from_terminal,
    to_terminal,
    seats: "12A-12D",
    baggage: "2×23 ק\"ג",
    notes: direction === "outbound" ? "צ'ק-אין נפתח 48 שעות לפני." : null,
  });

  const item = (
    day_date: string,
    start_time: string,
    title: string,
    category: string,
    sort_order: number,
    location: string | null = null,
    description: string | null = null,
  ): Row => ({
    trip_id: tripId,
    day_date,
    start_time,
    title,
    description,
    category,
    location,
    map_url: mapsUrl(location, category === "flight" ? null : "רודוס, יוון"),
    sort_order,
  });

  const suggestion = (
    kind: string,
    title: string,
    description: string,
    tags: string[] = [],
    age_min: number | null = null,
    age_max: number | null = null,
    price_level: string | null = null,
    liked = false,
    location: string | null = null,
  ): Row => ({
    trip_id: tripId,
    kind,
    title,
    description,
    tags,
    age_min,
    age_max,
    price_level,
    liked,
    location,
    map_url: location ? mapsUrl(location, "רודוס, יוון") : null,
  });

  const check = (
    title: string,
    sort_order: number,
    is_shared = true,
    is_done = false,
    participant_id: string | null = null,
  ): Row => ({ trip_id: tripId, title, is_done, is_shared, sort_order, participant_id });

  const doc = (
    name: string,
    category: string,
    external_url: string,
    participant_id: string | null = null,
  ): Row => ({ trip_id: tripId, name, category, external_url, storage_path: null, participant_id });

  await insertAll("flights", [
    flight("outbound", "LY381", "TLV", "RHO", at(0, "06:40"), at(0, "09:15"), "3", "1"),
    flight("inbound", "LY382", "RHO", "TLV", at(5, "20:10"), at(5, "22:35"), "1", "3"),
  ]);

  await insertAll("stays", [
    {
      trip_id: tripId,
      hotel_name: "Rodos Palace Resort",
      address: "Iraklidon Ave, Ialysos, Rhodes",
      check_in: iso(start),
      check_out: iso(end),
      booking_ref: "BK-778213",
      notes: "ארוחת בוקר כלולה. בריכה לילדים.",
      phone: "+302241000000",
      url: "https://example.com/rodos-palace",
      map_url: null,
    },
  ]);

  await insertAll("transfers", [
    {
      trip_id: tripId,
      kind: "car_rental",
      provider: "Hertz",
      pickup_location: "נמל התעופה רודוס",
      dropoff_location: "נמל התעופה רודוס",
      pickup_at: at(0, "10:00"),
      return_at: at(5, "18:00"),
      booking_ref: "HZ-99120",
      notes: "רכב משפחתי, כיסא בטיחות לילד.",
      phone: "+302241111111",
      url: "https://example.com/hertz-booking",
    },
  ]);

  await insertAll("itinerary_items", [
    item(dayN(0), "06:40", "טיסה לרודוס", "flight", 0, 'נתב"ג'),
    item(dayN(0), "10:00", "איסוף רכב שכור", "transport", 1, "נמל התעופה"),
    item(dayN(0), "14:00", "צ'ק אין ומנוחה בבריכה", "hotel", 2, "Rodos Palace"),
    item(dayN(1), "09:30", "העיר העתיקה של רודוס", "activity", 0, "Old Town", "ארמון המגיסטרים ורחוב האבירים. נוח לעגלה חלקית."),
    item(dayN(1), "13:00", "ארוחת צהריים ב-Marco Polo", "food", 1, "Old Town"),
    item(dayN(2), "10:00", "חוף צרפתי (Faliraki)", "activity", 0, "Faliraki", "מים רדודים — מתאים לילדים."),
    item(dayN(2), "17:00", "זמן חופשי / קניות", "free", 1),
    item(dayN(3), "09:00", "עמק הפרפרים", "activity", 0, "Petaloudes", "טיול קליל בצל, מתאים למשפחות."),
    item(dayN(4), "11:00", "לינדוס והאקרופוליס", "activity", 0, "Lindos", "עלייה מדרונית — אפשר חמורים לילדים."),
    item(dayN(5), "20:10", "טיסה חזרה לישראל", "flight", 0, "נמל התעופה רודוס"),
  ]);

  await insertAll("suggestions", [
    suggestion("attraction", "האקרופוליס של לינדוס", "אתר מרשים עם נוף לים. מומלץ בבוקר לפני החום.", ["היסטוריה", "נוף"], 5, 99, "mid", true, "Lindos Acropolis"),
    suggestion("attraction", "עמק הפרפרים", "שביל מוצל לאורך נחל — מושלם עם ילדים קטנים.", ["טבע", "משפחות"], 2, 99, "low", false, "Petaloudes Valley of the Butterflies"),
    suggestion("attraction", "אקווריום רודוס", "קטן אבל מקסים, פתרון מצוין ליום גשום.", ["ילדים"], 1, 12, "low", false, "Rhodes Aquarium"),
    suggestion("attraction", "מפרץ אנתוני קווין", "מים צלולים לשנרקול, סלעי — נעלי ים מומלצות.", ["חוף", "שנרקול"], 6, 99, "low", false, "Anthony Quinn Bay"),
    suggestion("restaurant", "Marco Polo Mansion", "חצר קסומה בעיר העתיקה. יש אפשרויות צמחוניות.", ["רומנטי", "צמחוני"], null, null, "high", false, "Marco Polo Mansion Rhodes"),
    suggestion("restaurant", "Tamam", "מטבח יווני מודרני, ידידותי למשפחות.", ["משפחות"], null, null, "mid", true, "Tamam Restaurant Rhodes"),
    suggestion("restaurant", "To Steno", "טברנה מקומית אותנטית, מנות לשיתוף.", ["אותנטי"], null, null, "low", false, "To Steno Tavern Rhodes"),
    suggestion("tip", "שכירת רכב משתלמת", "המרחקים ברודוס גדולים — רכב חוסך זמן וכסף מול מוניות."),
    suggestion("tip", "שעות החום", "בין 13:00–16:00 חם מאוד. תכננו בריכה או מנוחה."),
    suggestion("gear", "נעלי ים", "חלק מהחופים סלעיים — שווה להביא."),
  ]);

  await insertAll("checklist_items", [
    check("דרכונים בתוקף (6+ חודשים)", 0, true, true),
    check("ביטוח נסיעות", 1, true, true),
    check("אישורי טיסה ומלון", 2),
    check("קרם הגנה ומשקפי שמש", 3),
    check("ערכת עזרה ראשונה", 4),
    check("מתאם חשמל (יוון = אירופאי)", 5),
    check("בגדי ים ומגבות חוף", 6),
    check("חיתולים ומגבונים", 7, false, false, id["איתי כהן"] ?? null),
    check("צעצועים לטיסה", 8, false, false, id["יעל כהן"] ?? null),
    check("נעלי הליכה", 9, false, false, id["דני כהן"] ?? null),
  ]);

  await insertAll("trip_updates", [
    {
      trip_id: tripId,
      title: "מפגש בשדה ב-03:40",
      body: "נפגשים בטרמינל 3, ליד דלפק אל על. אל תשכחו דרכונים!",
      kind: "urgent",
      is_pinned: true,
    },
    {
      trip_id: tripId,
      title: "הרכב השכור שודרג",
      body: "קיבלנו רכב 7 מקומות במקום 5 — בלי תוספת תשלום.",
      kind: "info",
      is_pinned: false,
    },
    {
      trip_id: tripId,
      title: "צפי לגשם ביום רביעי",
      body: "שקלו להחליף את יום החוף עם האקווריום.",
      kind: "warning",
      is_pinned: false,
    },
  ]);

  await insertAll("documents", [
    doc("כרטיסי טיסה — כל המשפחה", "flight", "https://example.com/tickets"),
    doc("אישור מלון Rodos Palace", "hotel", "https://example.com/hotel"),
    doc("פוליסת ביטוח נסיעות", "insurance", "https://example.com/insurance"),
    doc("דרכון — יעל", "passport", "https://example.com/passport", id["יעל כהן"] ?? null),
  ]);

  return tripId;
}
