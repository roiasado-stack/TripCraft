/**
 * Destination highlights.
 *
 * Two layers, deliberately:
 *  1. CURATED — a short list of landmarks per city that are famous and stable
 *     (a UNESCO site does not close next season). No restaurants, no opening
 *     hours, no prices: those go stale and a wrong address ruins a trip day.
 *  2. GENERIC — category-based picks generated for ANY destination, each one
 *     resolving to a live Google Maps search. Always current, never invented.
 *
 * Every entry carries a map link built from its own name plus the city.
 */

import { mapsUrl } from "./maps";

export type DestinationPick = {
  title: string;
  description: string;
  kind: "attraction" | "restaurant" | "tip";
  tags: string[];
  age_min: number | null;
  age_max: number | null;
  /** Trip styles this suits; empty means "everyone". */
  styles: string[];
  /** Preference values this satisfies (beach, history, …). */
  prefs: string[];
  /** Search text used to build the map link. */
  place: string;
};

type Curated = Omit<DestinationPick, "place"> & { place?: string };

const A = (
  title: string,
  description: string,
  opts: Partial<Omit<Curated, "title" | "description">> = {},
): Curated => ({
  title,
  description,
  kind: opts.kind ?? "attraction",
  tags: opts.tags ?? [],
  age_min: opts.age_min ?? null,
  age_max: opts.age_max ?? null,
  styles: opts.styles ?? [],
  prefs: opts.prefs ?? [],
  place: opts.place,
});

/** Keys are lowercase and matched loosely against the typed destination. */
const CURATED: Record<string, Curated[]> = {
  limassol: [
    A("טירת לימסול", "טירה מימי הביניים במרכז העיר העתיקה, עם מוזיאון קטן.", { prefs: ["history"], age_min: 6 }),
    A("קוריון (Kourion)", "עיר עתיקה עם אמפיתיאטרון רומי ונוף לים.", { prefs: ["history"], age_min: 6 }),
    A("טיילת מולוס", "טיילת רחבה לאורך הים עם גנים ומתקני משחק.", { prefs: ["beach"], age_min: 0 }),
    A("סלע אפרודיטה", "מפרץ סלעי מפורסם, אתר צילום קלאסי.", { prefs: ["beach"] }),
    A("פארק המים פאסוליני", "פארק מים גדול — יום שלם עם ילדים.", { prefs: ["beach"], age_min: 4, age_max: 60, styles: ["family"] }),
  ],
  rhodes: [
    A("העיר העתיקה של רודוס", "עיר מוקפת חומה מימי הביניים, אתר מורשת עולמית.", { prefs: ["history"] }),
    A("ארמון המגיסטרים", "מבצר משוחזר עם פסיפסים מרשימים.", { prefs: ["history"], age_min: 6 }),
    A("לינדוס והאקרופוליס", "כפר לבן על צוק עם אקרופוליס עתיק מעליו.", { prefs: ["history"] }),
    A("עמק הפרפרים", "שביל מוצל לאורך נחל — קליל ומתאים למשפחות.", { prefs: ["history"], age_min: 2, styles: ["family"] }),
    A("מפרץ אנתוני קווין", "מפרץ סלעי עם מים צלולים, מצוין לשנרקול.", { prefs: ["beach"], age_min: 6 }),
  ],
  athens: [
    A("האקרופוליס והפרתנון", "האתר המזוהה ביותר עם אתונה. מומלץ מוקדם בבוקר.", { prefs: ["history"] }),
    A("מוזיאון האקרופוליס", "מוזיאון מודרני ומרשים למרגלות האתר.", { prefs: ["history"], age_min: 8 }),
    A("שכונת פלאקה", "סמטאות, חנויות וטברנות מתחת לאקרופוליס.", { prefs: ["shopping", "food"] }),
    A("שוק מונסטיראקי", "שוק פשפשים תוסס.", { prefs: ["shopping"] }),
  ],
  tbilisi: [
    A("העיר העתיקה של טביליסי", "סמטאות, מרפסות מגולפות ובתי מרחץ גופרית.", { prefs: ["history"] }),
    A("מבצר נריקאלה", "נוף פנורמי לעיר, נגיש ברכבל.", { prefs: ["history"] }),
    A("שדרות רוסתוואלי", "הרחוב הראשי — תיאטראות, מוזיאונים וקפה.", { prefs: ["shopping"] }),
  ],
  batumi: [
    A("טיילת בטומי", "טיילת ים ארוכה עם אופניים ופסלים.", { prefs: ["beach"] }),
    A("הגן הבוטני של בטומי", "גן ענק על צוק מעל הים.", { prefs: ["beach"], age_min: 4 }),
  ],
  rome: [
    A("הקולוסיאום", "האמפיתיאטרון הרומי המפורסם. כדאי להזמין כרטיס מראש.", { prefs: ["history"] }),
    A("הפורום הרומי", "לב רומא העתיקה, צמוד לקולוסיאום.", { prefs: ["history"] }),
    A("מזרקת טרווי", "מזרקת הברוק המפורסמת. עמוסה — עדיף מוקדם.", { prefs: ["history"] }),
    A("הוותיקן והקפלה הסיסטינית", "מוזיאונים ואמנות רנסאנס.", { prefs: ["history"], age_min: 8 }),
  ],
  prague: [
    A("גשר קארל", "גשר אבן היסטורי עם פסלים ונוף לנהר.", { prefs: ["history"] }),
    A("טירת פראג", "מתחם טירה ענק מעל העיר.", { prefs: ["history"] }),
    A("השעון האסטרונומי", "שעון ימי-ביניימי בכיכר העיר העתיקה.", { prefs: ["history"] }),
    A("הרובע היהודי (יוזפוב)", "בתי כנסת עתיקים ובית קברות יהודי היסטורי.", { prefs: ["history"] }),
  ],
  budapest: [
    A("בניין הפרלמנט", "אחד המבנים המרשימים באירופה, על גדת הדנובה.", { prefs: ["history"] }),
    A("מבצר הדייגים", "מרפסת תצפית ניאו-גותית עם נוף לעיר.", { prefs: ["history"] }),
    A("מרחצאות סצ'ני", "מרחצאות תרמיים גדולים ומפורסמים.", { prefs: ["beach"], age_min: 6, place: "Szechenyi Thermal Bath Budapest" }),
    A("בית הכנסת הגדול ברחוב דוהאני", "בית הכנסת הגדול באירופה.", { prefs: ["history"] }),
  ],
  barcelona: [
    A("סגרדה פמיליה", "הבזיליקה של גאודי. הזמנת כרטיסים מראש חובה.", { prefs: ["history"], place: "Sagrada Familia Barcelona" }),
    A("פארק גואל", "פארק צבעוני של גאודי עם נוף לעיר.", { prefs: ["history"], age_min: 3 }),
    A("לה רמבלה ושוק בוקריה", "השדרה המרכזית ושוק מזון תוסס.", { prefs: ["food", "shopping"] }),
    A("חוף ברסלונטה", "חוף עירוני עם טיילת ומסעדות.", { prefs: ["beach"] }),
  ],
  paris: [
    A("מגדל אייפל", "הסמל של פריז. כדאי להזמין עלייה מראש.", { prefs: ["history"] }),
    A("מוזיאון הלובר", "אחד המוזיאונים הגדולים בעולם.", { prefs: ["history"], age_min: 8 }),
    A("שדרות השאנז אליזה", "שדרה מרכזית לקניות ובתי קפה.", { prefs: ["shopping"] }),
    A("דיסנילנד פריז", "פארק שעשועים — יום שלם עם ילדים.", { prefs: ["shopping"], age_min: 3, age_max: 60, styles: ["family"] }),
  ],
  london: [
    A("ביג בן והפרלמנט", "סמל לונדון על גדת התמזה.", { prefs: ["history"] }),
    A("מגדל לונדון", "מצודה היסטורית עם תכשיטי הכתר.", { prefs: ["history"], age_min: 6 }),
    A("המוזיאון הבריטי", "אוסף עתיקות עצום, הכניסה חינם.", { prefs: ["history"], age_min: 7 }),
    A("עין לונדון", "גלגל ענק עם נוף פנורמי.", { prefs: ["shopping"], age_min: 4 }),
  ],
  dubai: [
    A("בורג' חליפה", "המבנה הגבוה בעולם, תצפית מרהיבה.", { prefs: ["shopping"] }),
    A("דובאי מול ומזרקות", "קניון ענק עם מופע מזרקות.", { prefs: ["shopping"] }),
    A("סוק דובאי הישן", "שוקי הזהב והתבלינים.", { prefs: ["shopping"] }),
  ],
  bangkok: [
    A("הארמון הגדול ווואט פרה קאיאו", "מתחם המקדשים המרכזי. יש קוד לבוש.", { prefs: ["history"], age_min: 6 }),
    A("וואט ארון", "מקדש השחר על גדת הנהר.", { prefs: ["history"] }),
    A("שוק צ'טוצ'ק", "שוק סופשבוע ענק.", { prefs: ["shopping"] }),
  ],
  istanbul: [
    A("איה סופיה", "מבנה היסטורי בן 1500 שנה.", { prefs: ["history"] }),
    A("המסגד הכחול", "מסגד עות'מאני מפורסם. יש קוד לבוש.", { prefs: ["history"] }),
    A("הבזאר המקורה", "אחד השווקים המקורים הגדולים בעולם.", { prefs: ["shopping"] }),
    A("ארמון טופקאפי", "ארמון הסולטנים עם נוף לבוספורוס.", { prefs: ["history"], age_min: 8 }),
  ],
};

/** Category picks that work for any city, each resolving to a live search. */
const GENERIC: { label: string; description: string; prefs: string[]; styles: string[]; age_min: number | null }[] = [
  { label: "מרכז העיר העתיקה", description: "הליבה ההיסטורית — בדרך כלל הנקודה הטובה להתחיל בה.", prefs: ["history"], styles: [], age_min: null },
  { label: "התצפית הטובה בעיר", description: "נקודת תצפית פנורמית על היעד.", prefs: [], styles: [], age_min: null },
  { label: "השוק המרכזי", description: "שוק מקומי — אוכל, מזכרות ואווירה אותנטית.", prefs: ["shopping", "food"], styles: [], age_min: null },
  { label: "המוזיאון המרכזי", description: "המוזיאון המרכזי של היעד.", prefs: ["history"], styles: [], age_min: 7 },
  { label: "החוף המומלץ", description: "החוף העיקרי באזור.", prefs: ["beach"], styles: [], age_min: null },
  { label: "פארק גדול / גן ציבורי", description: "מקום להתאוורר בו, נוח עם ילדים.", prefs: [], styles: ["family"], age_min: 0 },
  { label: "פארק שעשועים או מים", description: "יום שלם של כיף לילדים.", prefs: [], styles: ["family"], age_min: 3 },
  { label: "רובע הבילויים", description: "ברים ומסעדות לערב.", prefs: ["nightlife"], styles: ["friends", "couple"], age_min: 18 },
  { label: "רחוב הקניות המרכזי", description: "הרחוב הראשי לקניות.", prefs: ["shopping"], styles: [], age_min: null },
];

function normalize(destination: string): string {
  return destination.trim().toLowerCase();
}

/** Hebrew city names → the curated key. */
const ALIASES: Record<string, string> = {
  לימסול: "limassol",
  לימאסול: "limassol",
  רודוס: "rhodes",
  אתונה: "athens",
  טביליסי: "tbilisi",
  בטומי: "batumi",
  רומא: "rome",
  פראג: "prague",
  בודפשט: "budapest",
  ברצלונה: "barcelona",
  פריז: "paris",
  לונדון: "london",
  דובאי: "dubai",
  בנגקוק: "bangkok",
  איסטנבול: "istanbul",
  קפריסין: "limassol",
};

function curatedFor(destination: string): Curated[] {
  const norm = normalize(destination);
  for (const [heb, key] of Object.entries(ALIASES)) {
    if (destination.includes(heb)) return CURATED[key] ?? [];
  }
  for (const key of Object.keys(CURATED)) {
    if (norm.includes(key)) return CURATED[key];
  }
  return [];
}

/**
 * Builds highlight picks for a destination, filtered by trip style, the
 * group's ages and their stated preferences.
 */
export function destinationPicks(
  destination: string,
  opts: { style?: string; ages?: number[]; prefs?: string[] } = {},
): DestinationPick[] {
  const { style, ages = [], prefs = [] } = opts;
  const youngest = ages.length ? Math.min(...ages) : null;

  const fits = (p: { styles: string[]; prefs: string[]; age_min: number | null }) => {
    if (p.styles.length && style && !p.styles.includes(style)) return false;
    if (p.age_min != null && youngest != null && youngest < p.age_min) return false;
    if (prefs.length && p.prefs.length && !p.prefs.some((x) => prefs.includes(x))) return false;
    return true;
  };

  const curated = curatedFor(destination)
    .filter(fits)
    .map<DestinationPick>((c) => ({
      ...c,
      place: c.place ?? `${c.title} ${destination}`,
    }));

  const generic = GENERIC.filter(fits).map<DestinationPick>((g) => ({
    title: g.label,
    description: g.description,
    kind: "attraction",
    tags: ["חיפוש חי"],
    age_min: g.age_min,
    age_max: null,
    styles: g.styles,
    prefs: g.prefs,
    place: `${g.label} ${destination}`,
  }));

  // Curated first; generic fills the gaps without duplicating a curated theme.
  const seen = new Set(curated.map((c) => c.title));
  return [...curated, ...generic.filter((g) => !seen.has(g.title))];
}

/** Convenience: a pick ready to insert into `suggestions`. */
export function pickToRow(pick: DestinationPick, tripId: string, destination: string) {
  return {
    trip_id: tripId,
    kind: pick.kind,
    title: pick.title,
    description: pick.description,
    tags: pick.tags,
    age_min: pick.age_min,
    age_max: pick.age_max,
    price_level: null,
    liked: false,
    location: pick.place,
    map_url: mapsUrl(pick.place, destination),
  };
}

export function hasCurated(destination: string): boolean {
  return curatedFor(destination).length > 0;
}
