// Seeds a fictional demo travel agency ("טיולי הגשר — סוכנות לדוגמה") for ONE
// existing user, so the agency beta can be tried and demoed without real
// client data. Everything here is invented: names, the guide's phone
// (050-0000xxx), hotels, booking refs. Demo clients have NO phone, so a stray
// tap on "send on WhatsApp" can't message a real number — during a demo, type
// your own. No files are uploaded; passports are placeholder document rows with
// no file ("אין קובץ").
//
//   npm run seed:demo-agency -- agent-v1@test.local            seed (or refresh)
//   npm run seed:demo-agency -- agent-v1@test.local --remove   delete what it made
//
// Safety: it refuses a user whose agent account is suspended, and a user who
// already has a different agency (agent account or profile branding) unless
// --force is given, which replaces that agency with the demo one.
//
// What it does for that user:
//   1. agent_accounts row 'active' + the 'agent' role (as if Roi approved it),
//   2. profiles.agency_name / agency_color (the branding on the public page),
//   3. six trips in different states, each with a trip_clients row, travellers,
//      flights / hotel / transfer, a few itinerary items, and (for the sent
//      ones) public sharing + a join link that requires approval.
//
// Idempotent: the six trips have fixed ids derived from the user id, so running
// it again updates the same trips (dates move with today, share links and join
// links stay the same) and rebuilds their contents. --remove deletes exactly
// those ids (and only if they belong to this user), and turns the account back
// into a regular one if it still carries the demo agency name.
//
// Where it runs: by default the LOCAL Supabase (URL and service key from
// `npx supabase status`, like seed-break-ui.mjs). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment override that. Any URL that is
// not localhost is refused unless --prod is passed, and then it prints the plan
// and asks you to type the email again. The service key is never printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";

const DEMO_AGENCY = "טיולי הגשר — סוכנות לדוגמה";
const DEMO_AGENCY_PHONE = "03-0000000";
// Dark blue. The brochure uses it only as the accent edge of the agency strip (no text sits on it).
const DEMO_COLOR = "#1d4e89";
const TRIP_COUNT = 6;

// ---- arguments ------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const unknown = [...flags].filter((f) => f !== "--remove" && f !== "--prod" && f !== "--force");
if (!email || !email.includes("@") || unknown.length) {
  console.error("Usage: npm run seed:demo-agency -- <email of an existing user> [--remove] [--prod] [--force]");
  if (unknown.length) console.error(`Unknown flag: ${unknown.join(", ")}`);
  process.exit(2);
}
const REMOVE = flags.has("--remove");
const PROD = flags.has("--prod");
const FORCE = flags.has("--force");

// ---- connection -------------------------------------------------------------------
function localStatus() {
  const status = spawnSync("npx supabase status -o env", { encoding: "utf8", shell: true });
  return Object.fromEntries(
    (status.stdout ?? "")
      .split(/\r?\n/)
      .map((l) => l.match(/^(\w+)="?([^"]*)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

let apiUrl = process.env.SUPABASE_URL?.trim();
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!apiUrl || !serviceKey) {
  const env = localStatus();
  apiUrl = env.API_URL;
  serviceKey = env.SERVICE_ROLE_KEY;
}
if (!apiUrl || !serviceKey) {
  console.error(
    "No Supabase to talk to. Start the local one (npx supabase start), or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(2);
}
apiUrl = apiUrl.replace(/\/+$/, "");
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl);
if (!isLocal && !PROD) {
  console.error(`Refusing to run against ${new URL(apiUrl).host}: it is not a local Supabase.`);
  console.error("To seed production on purpose, add --prod (you will be asked to confirm).");
  process.exit(2);
}

const baseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

/** PostgREST call with the service key. Throws with the response text (never the key) on failure. */
async function rest(method, path, body, prefer) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, {
    method,
    headers: { ...baseHeaders, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const inList = (ids) => `in.(${ids.join(",")})`;

/** The auth user with this email (case-insensitive), or null. Pages through the admin API. */
async function findUser(address) {
  for (let page = 1; page < 100; page++) {
    const res = await fetch(`${apiUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: baseHeaders });
    if (!res.ok) throw new Error(`Listing users failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const users = (await res.json()).users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === address);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

/** Stable per-user trip ids, so re-running updates the same trips and --remove can't touch others. */
function demoTripId(userId, n) {
  const h = createHash("sha256").update(`tripcraft-demo-agency:${userId}:${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---- dates: the traveller's calendar day, from today's LOCAL date ---------------------------
const today = new Date();
today.setHours(12, 0, 0, 0); // noon: adding days never crosses a DST edge into the wrong day
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAt = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d;
};
const day = (offset) => ymd(dayAt(offset));
/** An instant: that day at this wall-clock time on the machine running the seed (Israel, for Roi). */
const at = (offset, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = dayAt(offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString(); // a full instant, not a calendar day
};
/** Offset (from today) of the first day on or after `offset` that falls on `weekday` (0 = Sunday). */
const firstWeekdayFrom = (offset, weekday) => {
  let o = offset;
  while (dayAt(o).getDay() !== weekday) o++;
  return o;
};
const firstFridayFrom = (offset) => firstWeekdayFrom(offset, 5);

// ---- the six trips ----------------------------------------------------------------------
// state: what the /agent list should show for it (agentTripStatus in src/lib/agent-board.ts).
function buildTrips() {
  // 2. Bar mitzvah: 40 travellers across six fictional families.
  const barMitzvahFamilies = [
    ["ברק", ["איתן", "שירה", "יונתן", "נועה", "סבא משה", "סבתא רחל", "ליאם"]],
    ["גלעדי", ["אבי", "מיכל", "עומר", "תמר", "אלה", "יואב", "רוני"]],
    ["שחר", ["גיל", "ענבל", "אורי", "ליה", "בן", "עדי"]],
    ["אדמוני", ["רן", "הילה", "נדב", "שקד", "יעלי", "אסף", "דנה"]],
    ["רונן", ["טל", "קרן", "אלון", "מאיה", "עידו", "שני"]],
    ["טליה", ["שי", "אורית", "ליאור", "גפן", "אגם", "יהלי", "נגה"]],
  ];
  const barMitzvahPeople = barMitzvahFamilies.flatMap(([surname, firsts]) => firsts.map((f) => `${f} ${surname}`));

  // Paris is built around one Shabbat: Thursday → Wednesday. The Thursday is 1–7 days
  // ahead, so the trip always shows "יוצא בקרוב" (departing within a week), and
  // nothing in it trips the itinerary's Shabbat warning (shabbatConflict in
  // ItineraryTab): no flight on Friday or Saturday, the Friday items are a morning
  // errand (always before candle lighting) and a dinner with no time, Saturday has
  // no items at all (any item there, timed or not, counts before havdalah), and the
  // walking tour is on Sunday.
  const parisStart = firstFridayFrom(2) - 1; // a Thursday
  const parisFriday = parisStart + 1;
  const parisEnd = parisStart + 6; // the Wednesday after
  // The bar mitzvah group keeps kosher too, so the same warning applies: Sunday → Thursday,
  // aliyah at the Monday Torah reading, nothing on Shabbat.
  const pragueStart = firstWeekdayFrom(45, 0);

  return [
    {
      n: 1,
      state: "attention — חסר דרכון אחד",
      trip: {
        title: "רומא עם הילדים",
        destination: "רומא, איטליה",
        start_date: day(21),
        end_date: day(26),
        trip_type: "family",
        cover_emoji: "🏛️",
        is_shared: true,
      },
      client: { client_name: "משפחת אלון (דמו)", client_phone: null },
      people: [
        { name: "דני אלון", age: 42 },
        { name: "רותם אלון", age: 40 },
        { name: "נועם אלון", age: 8 },
        { name: "מאיה אלון", age: 5 },
      ],
      passportsFor: 3, // Maya's is missing
      flights: [
        { direction: "outbound", airline: "אל על", flight_number: "LY383", from_airport: "TLV", to_airport: "FCO", depart_at: at(21, "07:10"), arrive_at: at(21, "10:05"), booking_ref: "DEMO-R1" },
        { direction: "inbound", airline: "אל על", flight_number: "LY384", from_airport: "FCO", to_airport: "TLV", depart_at: at(26, "16:40"), arrive_at: at(26, "21:15"), booking_ref: "DEMO-R1" },
      ],
      stays: [
        { hotel_name: "Albergo Esempio Trastevere", address: "Trastevere, Roma", check_in: day(21), check_out: day(26), booking_ref: "DEMO-H1", notes: "חדר משפחתי, ארוחת בוקר כלולה (דמו)" },
      ],
      transfers: [
        { kind: "transfer", provider: "הסעות דמו", pickup_location: "FCO", dropoff_location: "Albergo Esempio Trastevere", pickup_at: at(21, "10:45"), booking_ref: "DEMO-T1" },
      ],
      itinerary: [
        { offset: 22, start_time: "09:30", title: "הקולוסיאום והפורום הרומי", category: "activity", location: "Colosseo, Roma" },
        { offset: 23, start_time: "10:00", title: "מוזיאוני הוותיקן", category: "activity", location: "Musei Vaticani" },
        { offset: 23, start_time: "19:30", title: "ארוחת ערב בטרסטוורה", category: "food", location: "Trastevere, Roma" },
      ],
    },
    {
      n: 2,
      state: "sent — 40 נוסעים, כל הדרכונים",
      trip: {
        title: "בר המצווה של יונתן בפראג",
        destination: "פראג, צ'כיה",
        start_date: day(pragueStart),
        end_date: day(pragueStart + 4),
        trip_type: "family",
        cover_emoji: "🎉",
        is_shared: true,
      },
      client: { client_name: "משפחת ברק (דמו)", client_phone: null },
      people: barMitzvahPeople.map((name) => ({ name, preferences: ["kosher"] })),
      passportsFor: barMitzvahPeople.length,
      flights: [
        { direction: "outbound", airline: "ישראייר", flight_number: "6H761", from_airport: "TLV", to_airport: "PRG", depart_at: at(pragueStart, "06:00"), arrive_at: at(pragueStart, "09:30"), booking_ref: "DEMO-P2" },
        { direction: "inbound", airline: "ישראייר", flight_number: "6H762", from_airport: "PRG", to_airport: "TLV", depart_at: at(pragueStart + 4, "18:20"), arrive_at: at(pragueStart + 4, "23:10"), booking_ref: "DEMO-P2" },
      ],
      stays: [
        { hotel_name: "Hotel Příklad Old Town", address: "Staré Město, Praha", check_in: day(pragueStart), check_out: day(pragueStart + 4), booking_ref: "DEMO-H2", notes: "18 חדרים, קומה שלמה (דמו)" },
      ],
      transfers: [
        { kind: "transfer", provider: "אוטובוס דמו 50 מקומות", pickup_location: "PRG", dropoff_location: "Hotel Příklad Old Town", pickup_at: at(pragueStart, "10:15"), booking_ref: "DEMO-T2" },
      ],
      itinerary: [
        { offset: pragueStart + 1, start_time: "09:00", title: "עלייה לתורה בבית הכנסת הספרדי", category: "activity", location: "Španělská synagoga, Praha" },
        { offset: pragueStart + 1, start_time: "13:00", title: "סעודת בר מצווה (כשרה)", category: "food", location: "Josefov, Praha" },
        { offset: pragueStart + 2, start_time: "10:00", title: "טירת פראג וגשר קארל", category: "activity", location: "Pražský hrad" },
      ],
    },
    {
      n: 3,
      state: "soon — יוצאים תוך שבוע, שבת באמצע",
      trip: {
        title: "פריז, שבת ברובע היהודי",
        destination: "פריז, צרפת",
        start_date: day(parisStart),
        end_date: day(parisEnd),
        trip_type: "couple",
        cover_emoji: "🥐",
        is_shared: true,
      },
      client: { client_name: "יעל ואיתי שמש (דמו)", client_phone: null },
      // Kosher keepers: the itinerary shows Shabbat times (Hebcal, through the ask function).
      people: [
        { name: "יעל שמש", age: 34, preferences: ["kosher"] },
        { name: "איתי שמש", age: 36, preferences: ["kosher"] },
      ],
      passportsFor: 2,
      flights: [
        { direction: "outbound", airline: "אל על", flight_number: "LY325", from_airport: "TLV", to_airport: "CDG", depart_at: at(parisStart, "08:15"), arrive_at: at(parisStart, "12:05"), booking_ref: "DEMO-F3" },
        { direction: "inbound", airline: "אל על", flight_number: "LY326", from_airport: "CDG", to_airport: "TLV", depart_at: at(parisEnd, "15:30"), arrive_at: at(parisEnd, "20:20"), booking_ref: "DEMO-F3" },
      ],
      stays: [
        { hotel_name: "Hôtel Exemple Marais", address: "Le Marais, Paris", check_in: day(parisStart), check_out: day(parisEnd), booking_ref: "DEMO-H3", notes: "קרוב לרחוב רוזייה, בהליכה לבית הכנסת (דמו)" },
      ],
      transfers: [],
      itinerary: [
        // 11:00 is before candle lighting in Paris on every Friday of the year (earliest ≈ 16:35).
        { offset: parisFriday, start_time: "11:00", title: "קניות לשבת ברחוב רוזייה", category: "food", location: "Rue des Rosiers, Paris" },
        // No time: the meal follows candle lighting, whenever that is this week.
        { offset: parisFriday, start_time: null, title: "ארוחת שבת שהוזמנה מראש", category: "food", location: "Le Marais, Paris" },
        { offset: parisFriday + 2, start_time: "10:00", title: "סיור רגלי ברובע היהודי", category: "activity", location: "Le Marais, Paris" },
      ],
    },
    {
      n: 4,
      state: "abroad — הקבוצה בחו\"ל עכשיו",
      trip: {
        title: "קבוצת צעדים בברצלונה",
        destination: "ברצלונה, ספרד",
        start_date: day(-3),
        end_date: day(4),
        trip_type: "organized",
        cover_emoji: "🚌",
        is_shared: true,
        guide_name: "אבי המדריך (דמו)",
        guide_phone: "050-0000101",
      },
      client: { client_name: "מועדון צעדים (דמו)", client_phone: null },
      people: [
        "חנה לבני", "שמעון לבני", "רינה צור", "יוסי צור", "אסתר מור", "מאיר מור",
        "ציפי אורן", "דוד אורן", "שולה נחמיאס", "בני נחמיאס", "מרים שפר", "אברהם שפר",
      ],
      passportsFor: 12,
      flights: [
        { direction: "outbound", airline: "ארקיע", flight_number: "IZ261", from_airport: "TLV", to_airport: "BCN", depart_at: at(-3, "05:50"), arrive_at: at(-3, "09:40"), booking_ref: "DEMO-B4" },
        { direction: "inbound", airline: "ארקיע", flight_number: "IZ262", from_airport: "BCN", to_airport: "TLV", depart_at: at(4, "17:00"), arrive_at: at(4, "22:10"), booking_ref: "DEMO-B4" },
      ],
      stays: [
        { hotel_name: "Hotel Ejemplo Eixample", address: "Eixample, Barcelona", check_in: day(-3), check_out: day(4), booking_ref: "DEMO-H4", notes: "חצי פנסיון (דמו)" },
      ],
      transfers: [
        { kind: "transfer", provider: "אוטובוס דמו", pickup_location: "Hotel Ejemplo Eixample", dropoff_location: "Montserrat", pickup_at: at(1, "08:30"), booking_ref: "DEMO-T4" },
      ],
      itinerary: [
        { offset: 0, start_time: "09:30", title: "סגרדה פמיליה", category: "activity", location: "Sagrada Família, Barcelona" },
        { offset: 0, start_time: "14:00", title: "ארוחת צהריים בשוק לה בוקריה", category: "food", location: "Mercat de la Boqueria" },
        { offset: 1, start_time: "08:30", title: "יום טיול למונסראט", category: "activity", location: "Montserrat" },
      ],
      updates: [
        { title: "מחר: האוטובוס יוצא ב-08:30 מהלובי", body: "לקחת מים, כובע ונעלי הליכה. חוזרים לארוחת ערב במלון. (עדכון דמו)", kind: "info", is_pinned: true },
      ],
    },
    {
      n: 5,
      state: "draft — עוד לא נשלח ללקוח",
      trip: {
        title: "אמסטרדם על אופניים",
        destination: "אמסטרדם, הולנד",
        start_date: day(60),
        end_date: day(65),
        trip_type: "family",
        cover_emoji: "🚲",
        is_shared: false,
      },
      client: { client_name: "משפחת נחום (דמו)", client_phone: null },
      people: [
        { name: "עמית נחום", age: 45 },
        { name: "שרון נחום", age: 44 },
        { name: "גיא נחום", age: 15 },
      ],
      passportsFor: 0,
      flights: [
        { direction: "outbound", airline: "אל על", flight_number: "LY335", from_airport: "TLV", to_airport: "AMS", depart_at: at(60, "09:00"), arrive_at: at(60, "13:10"), booking_ref: "DEMO-A5" },
        { direction: "inbound", airline: "אל על", flight_number: "LY336", from_airport: "AMS", to_airport: "TLV", depart_at: at(65, "15:00"), arrive_at: at(65, "20:30"), booking_ref: "DEMO-A5" },
      ],
      stays: [],
      transfers: [],
      itinerary: [],
    },
    {
      n: 6,
      state: "back — הטיול נגמר",
      trip: {
        title: "לונדון לזוג",
        destination: "לונדון, בריטניה",
        start_date: day(-20),
        end_date: day(-14),
        trip_type: "couple",
        cover_emoji: "💂",
        is_shared: true,
      },
      client: { client_name: "רון ודנה גל (דמו)", client_phone: null },
      people: [
        { name: "רון גל", age: 31 },
        { name: "דנה גל", age: 30 },
      ],
      passportsFor: 2,
      flights: [
        { direction: "outbound", airline: "בריטיש איירווייז", flight_number: "BA164", from_airport: "TLV", to_airport: "LHR", depart_at: at(-20, "10:30"), arrive_at: at(-20, "14:15"), booking_ref: "DEMO-L6" },
        { direction: "inbound", airline: "בריטיש איירווייז", flight_number: "BA165", from_airport: "LHR", to_airport: "TLV", depart_at: at(-14, "22:00"), arrive_at: at(-13, "04:50"), booking_ref: "DEMO-L6" },
      ],
      stays: [
        { hotel_name: "The Example Hotel Covent Garden", address: "Covent Garden, London", check_in: day(-20), check_out: day(-14), booking_ref: "DEMO-H6", notes: null },
      ],
      transfers: [],
      itinerary: [
        { offset: -19, start_time: "10:00", title: "מגדל לונדון", category: "activity", location: "Tower of London" },
        { offset: -18, start_time: "19:30", title: "מחזמר בווסט אנד", category: "activity", location: "West End, London" },
      ],
    },
  ].map((t) => ({
    ...t,
    people: t.people.map((p) => (typeof p === "string" ? { name: p } : p)),
  }));
}

// ---- safety -------------------------------------------------------------------------------
/**
 * What the seed would overwrite on this user. `blocked`: never seed (a suspended agent —
 * un-suspending is an admin decision, not a seed side effect). `conflicts`: a real agency
 * that only --force may replace.
 */
async function preflight(uid) {
  const [account] = await rest("GET", `agent_accounts?select=status,agency_name&user_id=eq.${uid}`);
  const [profile] = await rest("GET", `profiles?select=agency_name,agency_logo_url&id=eq.${uid}`);
  const blocked = account?.status === "suspended"
    ? `this user is a SUSPENDED agent ("${account.agency_name}"). The seed never re-activates an account — decide in /admin/agents, or use another user.`
    : null;
  const conflicts = [];
  if (account && account.agency_name !== DEMO_AGENCY) {
    conflicts.push(`an agent account for "${account.agency_name}" (${account.status})`);
  }
  const profileName = profile?.agency_name?.trim();
  if (profileName && profileName !== DEMO_AGENCY) {
    conflicts.push(`agency branding "${profileName}" on the profile`);
  } else if (!profileName && profile?.agency_logo_url && account?.agency_name !== DEMO_AGENCY) {
    conflicts.push("an agency logo on the profile");
  }
  return { blocked, conflicts };
}

// ---- seed ---------------------------------------------------------------------------------
async function seed(user) {
  const uid = user.id;
  const now = new Date().toISOString();

  // 1. Agent account + role, as if approved in /admin/agents. Limits keep their defaults
  //    on a new row and are left alone on an existing one.
  await rest(
    "POST",
    "agent_accounts?on_conflict=user_id",
    [{ user_id: uid, status: "active", agency_name: DEMO_AGENCY, phone: DEMO_AGENCY_PHONE, decided_at: now }],
    "resolution=merge-duplicates,return=minimal",
  );
  await rest(
    "POST",
    "user_roles?on_conflict=user_id,role",
    [{ user_id: uid, role: "agent" }],
    "resolution=ignore-duplicates,return=minimal",
  );

  // 2. Branding on the public page (an active agent's only, migration 023).
  await rest(
    "POST",
    "profiles?on_conflict=id",
    [{ id: uid, agency_name: DEMO_AGENCY, agency_color: DEMO_COLOR }],
    "resolution=merge-duplicates,return=minimal",
  );

  // 3. Trips. Upsert by fixed id: an existing demo trip keeps its share_slug (links already sent keep working).
  const plans = buildTrips();
  const ids = plans.map((p) => demoTripId(uid, p.n));
  const tripRows = plans.map((p, i) => ({
    id: ids[i],
    user_id: uid,
    budget_level: "mid",
    notes: "טיול לדוגמה של סוכנות הדמו — כל השמות והפרטים בדויים.",
    guide_name: null,
    guide_phone: null,
    image_url: null,
    is_template: false,
    ...p.trip,
  }));
  const trips = await rest("POST", "trips?on_conflict=id&select=id,share_slug,is_shared", tripRows, "resolution=merge-duplicates,return=representation");
  const slugById = new Map(trips.map((t) => [t.id, t]));

  // Rebuild what the seed owns inside those trips. Documents: only rows without a file
  // (the placeholder passports) — a file someone uploaded during a demo stays.
  for (const table of ["participants", "flights", "stays", "transfers", "itinerary_items", "trip_updates"]) {
    await rest("DELETE", `${table}?trip_id=${inList(ids)}`, undefined, "return=minimal");
  }
  await rest("DELETE", `documents?trip_id=${inList(ids)}&storage_path=is.null`, undefined, "return=minimal");

  await rest(
    "POST",
    "trip_clients?on_conflict=trip_id",
    plans.map((p, i) => ({ trip_id: ids[i], ...p.client })),
    "resolution=merge-duplicates,return=minimal",
  );

  const people = plans.flatMap((p, i) =>
    p.people.map((x) => ({ trip_id: ids[i], name: x.name, age: x.age ?? null, preferences: x.preferences ?? [] })),
  );
  const insertedPeople = await rest("POST", "participants?select=id,trip_id,name", people, "return=representation");

  // Placeholder passports: no file, private to the agent (uploaded_by = the agent).
  const docs = [];
  plans.forEach((p, i) => {
    const mine = p.people.slice(0, p.passportsFor).map((x) => x.name);
    for (const name of mine) {
      const participant = insertedPeople.find((r) => r.trip_id === ids[i] && r.name === name);
      docs.push({
        trip_id: ids[i],
        participant_id: participant?.id ?? null,
        category: "passport",
        name: `דרכון — ${name} (דמו, אין קובץ)`,
        storage_path: null,
        external_url: null,
        uploaded_by: uid,
        visibility: "private",
      });
    }
  });
  if (docs.length) await rest("POST", "documents", docs, "return=minimal");

  const rowsFor = (key, extra) =>
    plans.flatMap((p, i) => (p[key] ?? []).map((r) => ({ trip_id: ids[i], ...extra(r) })));
  const flights = rowsFor("flights", (r) => r);
  const stays = rowsFor("stays", (r) => ({ address: null, booking_ref: null, notes: null, ...r }));
  const transfers = rowsFor("transfers", (r) => r);
  const itinerary = plans.flatMap((p, i) =>
    p.itinerary.map((r, k) => ({
      trip_id: ids[i],
      day_date: day(r.offset),
      start_time: r.start_time,
      title: r.title,
      category: r.category,
      location: r.location,
      sort_order: k,
    })),
  );
  const updates = rowsFor("updates", (r) => ({ ...r, created_by: uid }));
  if (flights.length) await rest("POST", "flights", flights, "return=minimal");
  if (stays.length) await rest("POST", "stays", stays, "return=minimal");
  if (transfers.length) await rest("POST", "transfers", transfers, "return=minimal");
  if (itinerary.length) await rest("POST", "itinerary_items", itinerary, "return=minimal");
  if (updates.length) await rest("POST", "trip_updates", updates, "return=minimal");

  // Join links (participant, requires approval) for the trips that were "sent". Keep a live one.
  const sentIds = plans.filter((p) => p.trip.is_shared).map((p) => demoTripId(uid, p.n));
  const live = await rest("GET", `trip_invites?select=trip_id&role=eq.participant&revoked_at=is.null&trip_id=${inList(sentIds)}`);
  const haveInvite = new Set(live.map((r) => r.trip_id));
  const newInvites = sentIds
    .filter((id) => !haveInvite.has(id))
    .map((id) => ({ trip_id: id, role: "participant", requires_approval: true, created_by: uid }));
  if (newInvites.length) await rest("POST", "trip_invites", newInvites, "return=minimal");

  // ---- report ----
  console.log(`\nDemo agency "${DEMO_AGENCY}" is ready for ${user.email}.`);
  console.log(`  agent account: active, role 'agent', colour ${DEMO_COLOR}`);
  console.log(`  ${plans.length} trips, ${people.length} travellers, ${docs.length} placeholder passports (no files)\n`);
  for (const [i, p] of plans.entries()) {
    const t = slugById.get(ids[i]);
    const share = t?.is_shared && t.share_slug ? `/share/${t.share_slug}` : "(not shared)";
    console.log(`  ${p.n}. ${p.trip.title.padEnd(28)} ${p.state}`);
    console.log(`     /trip/${ids[i]}   ${share}`);
  }
  console.log("\nSign in as that user and open /agent. If the app was already open, reload it once.");
}

// ---- remove -------------------------------------------------------------------------------
async function remove(user) {
  const uid = user.id;
  const ids = Array.from({ length: TRIP_COUNT }, (_, i) => demoTripId(uid, i + 1));
  const owned = `id=${inList(ids)}&user_id=eq.${uid}`;

  // Files someone uploaded into a demo trip during a demo: remove them from storage too,
  // or deleting the trip would leave them orphaned in trip-docs.
  const files = await rest("GET", `documents?select=storage_path&trip_id=${inList(ids)}&storage_path=not.is.null`);
  const paths = files.map((f) => f.storage_path).filter(Boolean);
  if (paths.length) {
    const res = await fetch(`${apiUrl}/storage/v1/object/trip-docs`, {
      method: "DELETE",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error(`Removing ${paths.length} uploaded file(s) failed: ${res.status}`);
  }

  const deleted = await rest("DELETE", `trips?${owned}&select=id`, undefined, "return=representation");

  // The account goes back to a regular one only if it still is the demo agency.
  const accounts = await rest("GET", `agent_accounts?select=agency_name&user_id=eq.${uid}`);
  let accountNote = "agent account left as is (no demo agency on it)";
  if (accounts[0]?.agency_name === DEMO_AGENCY) {
    await rest("DELETE", `agent_accounts?user_id=eq.${uid}`, undefined, "return=minimal");
    await rest("DELETE", `user_roles?user_id=eq.${uid}&role=eq.agent`, undefined, "return=minimal");
    accountNote = "agent account and 'agent' role removed";
  }
  const profiles = await rest("GET", `profiles?select=agency_name,agency_color&id=eq.${uid}`);
  if (profiles[0]?.agency_name === DEMO_AGENCY) {
    await rest("PATCH", `profiles?id=eq.${uid}`, { agency_name: null, agency_color: null }, "return=minimal");
  }

  console.log(`\nRemoved the demo agency from ${user.email}:`);
  console.log(`  ${deleted.length} demo trip(s) deleted (with their travellers, bookings, clients and links)`);
  if (paths.length) console.log(`  ${paths.length} uploaded file(s) removed from trip-docs`);
  console.log(`  ${accountNote}`);
  console.log("  No other trip was touched.");
}

// ---- main ---------------------------------------------------------------------------------
// Returns the exit code; never calls process.exit right after readline (crashes Node on Windows).
async function main() {
let user;
try {
  user = await findUser(email);
} catch (e) {
  console.error(`Could not reach ${new URL(apiUrl).host}: ${e instanceof Error ? e.message : e}`);
  return 1;
}
if (!user) {
  console.error(`No user with the email ${email} on ${new URL(apiUrl).host}. Sign up first, then run this again.`);
  return 1;
}

// Seeding over a real agency: never for a suspended one, otherwise only with --force.
let conflicts = [];
if (!REMOVE) {
  let check;
  try {
    check = await preflight(user.id);
  } catch (e) {
    console.error(`Could not read the account of ${user.email}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  if (check.blocked) {
    console.error(`Refusing: ${check.blocked} Nothing was changed.`);
    return 1;
  }
  conflicts = check.conflicts;
  if (conflicts.length && !FORCE) {
    console.error(`Refusing: ${user.email} already has ${conflicts.join(" and ")}.`);
    console.error("The seed would replace it with the demo agency. Use a fresh user, or add --force to replace it on purpose.");
    console.error("Nothing was changed.");
    return 1;
  }
}

if (!isLocal) {
  const host = new URL(apiUrl).host;
  console.log(`\n*** PRODUCTION: ${host} ***`);
  console.log(`User: ${user.email} (${user.id})`);
  if (REMOVE) {
    console.log("This will DELETE the six demo trips of this user (only those, by their fixed ids),");
    console.log("and, if the account still has the demo agency name, remove its agent account and 'agent' role.");
  } else {
    console.log(`This will make this account the demo agency "${DEMO_AGENCY}":`);
    console.log("  - agent account 'active' + the 'agent' role (as if you approved it in /admin/agents)");
    console.log(`  - agency name and colour ${DEMO_COLOR} on the profile (shown on the public trip pages)`);
    console.log("  - six fictional trips with clients (no phone numbers), travellers, bookings; five of them shared with a public link");
    console.log("It refuses a suspended agent, and an account that already has another agency unless --force.");
    if (conflicts.length) {
      console.log(`  --force: this REPLACES ${conflicts.join(" and ")} with the demo agency.`);
    }
    console.log("Re-running it later updates the same six trips. Remove it all with --remove.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("\nType the user's email again to continue: ")).trim().toLowerCase();
  rl.close();
  if (answer !== email) {
    console.error("The email doesn't match. Nothing was changed.");
    return 1;
  }
}

try {
  if (REMOVE) await remove(user);
  else await seed(user);
} catch (e) {
  console.error(`\nFailed: ${e instanceof Error ? e.message : e}`);
  console.error("Run it again: the seed is idempotent, and --remove cleans up a half-finished run.");
  return 1;
}
return 0;
}

process.exitCode = await main();
