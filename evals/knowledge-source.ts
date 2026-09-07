/**
 * Content for the find_kosher knowledge base — Cyprus, Rome, Batumi only
 * (the 3 destinations chosen 2026-09-04, pending the real travel agent's
 * answer — see FINAL-PROJECT-BRIEF.md §5 שלב ד). Every fact here was
 * gathered by an agent with live WebFetch/WebSearch against chabad.org, the
 * Chief Rabbinate of Cyprus, totallyjewishtravel.com and chabadbatumi.ge on
 * 2026-09-03 — nothing here is recalled from training data or guessed.
 * Shabbat times are deliberately NOT hardcoded (they'd be wrong for any date
 * but the one looked up) — those chunks point to chabad.org's live per-city
 * page instead, matching the same "live search over stale data" philosophy
 * already used in src/lib/maps.ts's kosherSearchUrl/chabadSearchUrl.
 *
 * Consumed by seed-knowledge.ts, which embeds each `content` string with
 * Voyage AI and inserts the row into knowledge_chunks.
 */

export type KnowledgeChunk = {
  destination: "cyprus" | "rome" | "batumi";
  category: "chabad" | "kosher" | "shabbat" | "poi";
  title: string;
  content: string;
  source_url: string;
  source_verified_on: string; // YYYY-MM-DD
};

const VERIFIED = "2026-09-03";

export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  // --- Cyprus --------------------------------------------------------------
  {
    destination: "cyprus",
    category: "chabad",
    title: "בתי חב״ד בקפריסין",
    content:
      "בקפריסין יש בית חב״ד מרכזי בלרנקה: Chabad - CJCC (Cyprus Jewish Community Centres), כתובת Apollodorou 4, Larnaca 6020, טלפון +357-24-668-753, אתר ChabadCyprus.com, בראשות הרב אריה זאב רסקין. בלימסול פועל Chabad House of Limassol, כתובת Porfyriou Dikaiou 5, Limassol 3095, טלפון +357-25-363-770, אתר chabadlimassol.com, בראשות הרב יאיר בייץ. קיימים גם סניפים קטנים יותר באיה נאפה, בפאפוס ובקפריסין הצפונית.",
    source_url: "https://www.chabad.org/jewish-centers/118616/Larnaca/Synagogue/Chabad-CJCC-Cyprus-Jewish-Community-Centres",
    source_verified_on: VERIFIED,
  },
  {
    destination: "cyprus",
    category: "kosher",
    title: "מסעדות ועסקי מזון כשרים בקפריסין",
    content:
      "בלרנקה פועלת מחלקת כשרות של הרבנות הראשית לקפריסין. מסעדות ועסקים עם תעודת כשרות מהדרין, כולם בכתובת בית חב״ד (Apollodorou 4, Larnaca): Sambation (בשרי, טל׳ +357-24242425), Shamaim (חלבי/פיצה, טל׳ +357-95590988), Holy Sushi (טל׳ +357-95054586), Glatt-Shop (מכולת כשרה, טל׳ +357-24242420). בכיכר זוחורי בלרנקה פועלת גם Burger Philosophy, מופיעה ברשימת הרבנות ללא ציון רמת השגחה. בלימסול מופיעות ברשימת הרבנות המסעדות Alenbi ו-Moses (מהדרין), וכן King David, BRACHA Catering, Delicateso, Asado ו-Honi Poke — ללא ציון רמת השגחה וללא כתובות מפורסמות. מומלץ לוודא תעודת כשרות בפועל במקום לפני הזמנה, במיוחד בלימסול.",
    source_url: "https://rabbinatecyprus.org/en/info/6372/",
    source_verified_on: VERIFIED,
  },
  {
    destination: "cyprus",
    category: "shabbat",
    title: "זמני שבת בקפריסין",
    content:
      "זמני כניסת ויציאת שבת משתנים כל שבוע — אין להסתמך על מספר קבוע. לזמנים מדויקים ומעודכנים בלרנקה: https://www.chabad.org/calendar/candlelighting_cdo/locationId/671/locationType/1/jewish/Candle-Lighting.htm — ובלימסול: https://www.chabad.org/calendar/candlelighting_cdo/locationId/779/locationType/1/jewish/Candle-Lighting.htm",
    source_url: "https://www.chabad.org/calendar/candlelighting_cdo/locationId/671/locationType/1/jewish/Candle-Lighting.htm",
    source_verified_on: VERIFIED,
  },
  {
    destination: "cyprus",
    category: "poi",
    title: "נקודות עניין בקפריסין",
    content:
      "בלרנקה: חוף פיניקודס (Finikoudes) — טיילת חוף עם דקלים ומים רדודים, מתאים למשפחות; אגם המלח וחלה סולטן טקה — אגם עם פלמינגו בחורף ומסגד עתיק לצידו; אמת המים העות׳מאנית (Kamares Aqueduct) מהמאה ה-18. בלימסול: טירת לימסול והעיר העתיקה — טירה מימי הביניים עם מוזיאון קפריסין הימי-ביניימי בתוכה; קוריון (Kourion) — אתר ארכיאולוגי יווני-רומי עם אמפיתיאטרון משוחזר ופסיפסים.",
    source_url: "https://www.chabad.org/jewish-centers/118616/Larnaca",
    source_verified_on: VERIFIED,
  },

  // --- Rome ------------------------------------------------------------------
  {
    destination: "rome",
    category: "chabad",
    title: "בתי חב״ד ברומא",
    content:
      "ברומא פועל Chabad-Lubavitch of Rome בראשות הרב יצחק חזן, טלפון +39-33-3813-0919, אתר www.chabadroma.org (כתובת מדויקת אינה מפורסמת — מומלץ ליצור קשר טלפוני או במייל מראש). בגטו היהודי של רומא פועל גם Beis Chabad Jewish Ghetto Rome, כתובת Via di S. Maria del Pianto 1A, Rome 00186, טלפון +39-06-3649-2393, אתר www.chabadjewishghettorome.it, בראשות הרב אהרון (רוני) קנרוטו.",
    source_url: "https://www.chabad.org/jewish-centers/118623/Rome/Synagogue/Chabad-Lubavitch-of-Rome",
    source_verified_on: VERIFIED,
  },
  {
    destination: "rome",
    category: "kosher",
    title: "מסעדות כשרות ברומא",
    content:
      "מסעדות בהשגחת בית הדין הרבני של רומא (Beth Din Rome), רובן באזור הגטו היהודי סביב Via Portico d'Ottavia: Ba'Ghetto (בשרי, טל׳ +39 06 6889 2868), Ba'Ghetto Milky (חלבי, טל׳ +39 06 6830 0077), Bellacarne (בשרי, טל׳ +39 06 683 3104), Bona Pizza Romana (חלבי/פיצה, גלאט, טל׳ +39 06 6880 5820), Casalino Osteria Kosher (חלבי, טל׳ +39 06 7978 1514), Little Tripoli (בשרי, טל׳ +39 06 6422 0481). Lisa Kosher פועלת בהשגחת חב״ד (טל׳ +39 338 1690147). כתובות מדויקות משתנות — מומלץ לוודא בעת ההזמנה.",
    source_url: "https://totallyjewishtravel.com/kosherrestaurants-TJ920-Rome_Italy-Kosher_Eateries.html",
    source_verified_on: VERIFIED,
  },
  {
    destination: "rome",
    category: "shabbat",
    title: "זמני שבת ברומא",
    content:
      "זמני כניסת ויציאת שבת משתנים כל שבוע — אין להסתמך על מספר קבוע. לזמנים מדויקים ומעודכנים ברומא: https://www.chabad.org/calendar/candlelighting_cdo/locationId/449/locationType/1/jewish/Candle-Lighting.htm",
    source_url: "https://www.chabad.org/calendar/candlelighting_cdo/locationId/449/locationType/1/jewish/Candle-Lighting.htm",
    source_verified_on: VERIFIED,
  },
  {
    destination: "rome",
    category: "poi",
    title: "נקודות עניין ברומא",
    content:
      "הקולוסאום — האמפיתיאטרון הרומי המפורסם מהמאה הראשונה; הפורום הרומי וגבעת הפלטין — המרכז הציבורי של רומא העתיקה, סמוך לקולוסאום; הפנתאון — מקדש רומי ששרד במלואו, כניסה חינם; מזרקת טרווי — מזרקה בארוקית ואתר צילום מרכזי; מוזיאוני הוותיקן וכנסיית פטרוס הקדוש — כולל קפלת הסיסטינה והכנסייה הגדולה בעולם.",
    source_url: "https://www.chabad.org/jewish-centers/118623/Rome",
    source_verified_on: VERIFIED,
  },

  // --- Batumi ------------------------------------------------------------------
  {
    destination: "batumi",
    category: "chabad",
    title: "בית חב״ד בבאטומי",
    content:
      "בבאטומי פועל בית חב״ד יחיד: Chabad of Batumi, כתובת 10 V. Gorgasali Street, Batumi 0160, טלפון +995-551-122-369, אתר www.chabadbatumi.ge, בראשות הרב זאב מנדלזון.",
    source_url: "https://www.chabad.org/jewish-centers/3962588/Batumi/Synagogue/Chabad-of-Batumi",
    source_verified_on: VERIFIED,
  },
  {
    destination: "batumi",
    category: "kosher",
    title: "מסעדות כשרות בבאטומי",
    content:
      "בבאטומי אין רבנות מקומית מוסמכת המפקחת על כשרות — ההשגחה היא באחריות חב״ד באטומי או רב מקומי (Vaad), רמה פחות רשמית מקפריסין או רומא. מסעדות: Mendi's Kosher Restaurant, בתוך בית חב״ד, 10 Gorgasali Street (בשרי, השגחת חב״ד, טל׳ +995-551-122-369); Kinor David Kosher Restaurant ו-Kohelet Kosher Restaurant, בתוך מלון King Solomon, 19 Pirosmani Street (בשרי/חלבי בהתאמה, השגחת רב מקומי, טל׳ +995 422 21 10 77); Organique Batumi (בשרי, השגחת רב מקומי, טל׳ +972 52-889-9454).",
    source_url: "https://www.totallyjewishtravel.com/kosherrestaurants-TJ7799-Batumi_Georgia-Kosher_Eateries.html",
    source_verified_on: VERIFIED,
  },
  {
    destination: "batumi",
    category: "shabbat",
    title: "זמני שבת בבאטומי",
    content:
      "זמני כניסת ויציאת שבת משתנים כל שבוע — אין להסתמך על מספר קבוע. לזמנים מדויקים ומעודכנים בבאטומי: https://www.chabad.org/calendar/candlelighting_cdo/locationId/1649/locationType/1/jewish/Candle-Lighting.htm",
    source_url: "https://www.chabad.org/calendar/candlelighting_cdo/locationId/1649/locationType/1/jewish/Candle-Lighting.htm",
    source_verified_on: VERIFIED,
  },
  {
    destination: "batumi",
    category: "poi",
    title: "נקודות עניין בבאטומי",
    content:
      "פסל עלי ונינו (Ali and Nino) — שני פסלי מתכת נעים שמתמזגים זה בזה, מרשים לראות בשקיעה על הטיילת; טיילת באטומי (Batumi Boulevard) — הטיילת הראשית לאורך החוף; הגן הבוטני של באטומי — גן גדול על הגבעה מול הים השחור, מתאים לעגלות; הרכבל ארגו (Argo Cable Car) — עולה להר אנוריה עם נוף פנורמי; מגדל האלפבית — מגדל בצורת DNA עם 33 אותיות האלפבית הגאורגי ומרפסת תצפית.",
    source_url: "https://www.chabad.org/jewish-centers/3962588/Batumi",
    source_verified_on: VERIFIED,
  },
];
