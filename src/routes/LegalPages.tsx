import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { LEGAL, isPlaceholder } from "@/lib/legal";
import { cn } from "@/lib/utils";

/*
 * Public legal pages: /terms, /privacy, /credits, /accessibility.
 * Reachable without logging in (signup screen, share page footer).
 * Business details come from @/lib/legal — fill them in there, not here.
 *
 * These are drafts written against what the app actually does (see
 * supabase/functions and migration 013). Have a lawyer review before launch.
 */

/** A business detail; unfilled [placeholders] are highlighted so they can't ship unnoticed. */
function V({ children }: { children: string }) {
  if (isPlaceholder(children)) {
    return <mark className="rounded bg-sun px-1 text-sun-foreground">{children}</mark>;
  }
  return <>{children}</>;
}

function Email() {
  if (isPlaceholder(LEGAL.contactEmail)) return <V>{LEGAL.contactEmail}</V>;
  return (
    <a href={`mailto:${LEGAL.contactEmail}`} dir="ltr" className="text-primary underline underline-offset-2">
      {LEGAL.contactEmail}
    </a>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-6 font-display text-lg font-bold">{children}</h2>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-2 leading-relaxed">{children}</p>;
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="mb-2 list-disc space-y-1 ps-5 leading-relaxed">{children}</ul>;
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      <header className="mb-4 flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          className="grid size-10 place-items-center rounded-2xl border border-border bg-card"
          aria-label="חזרה"
        >
          <ChevronRight className="size-5" />
        </button>
        <h1 className="font-display text-xl font-extrabold">{title}</h1>
      </header>
      <p className="mb-4 text-xs text-muted-foreground">עדכון אחרון: {LEGAL.lastUpdated}</p>
      <article className="text-sm text-foreground">{children}</article>
      <LegalLinks className="mt-10" />
    </div>
  );
}

/** Footer row linking every legal page — used on the auth, settings and share pages. */
export function LegalLinks({ className }: { className?: string }) {
  const links = [
    { to: "/terms", label: "תנאי שימוש" },
    { to: "/privacy", label: "מדיניות פרטיות" },
    { to: "/accessibility", label: "הצהרת נגישות" },
    { to: "/credits", label: "קרדיטים ורישיונות" },
  ];
  return (
    <nav className={cn("flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="underline underline-offset-2 hover:text-foreground">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="תנאי שימוש">
      <P>
        ברוכים הבאים ל-TripCraft ("השירות"), שמופעל על ידי <V>{LEGAL.businessName}</V> (<V>{LEGAL.businessId}</V>)
        ("אנחנו"). השימוש בשירות מהווה הסכמה לתנאים האלה ול<Link to="/privacy" className="text-primary underline underline-offset-2">מדיניות הפרטיות</Link>.
        אם אינכם מסכימים, אל תשתמשו בשירות. התנאים מנוסחים בלשון רבים ומתייחסים לכל המגדרים.
      </P>

      <H>1. מה השירות עושה</H>
      <P>
        TripCraft הוא כלי לתכנון וניהול טיולים: מסלול יומי, טיסות, לינה, משתתפים, מסמכים, צ'קליסט, המלצות וקישור
        שיתוף. חלק מהתכנים (המלצות, מסלולים, תשובות בצ'אט, זיהוי פרטים מדרכונים ומשוברים) נוצרים באמצעות בינה
        מלאכותית.
      </P>
      <P>
        <strong>אנחנו לא סוכנות נסיעות.</strong> השירות לא מבצע הזמנות, לא מוכר כרטיסים ולא אחראי לשירותים של
        חברות תעופה, מלונות, ספקי הסעות או כל צד שלישי אחר.
      </P>

      <H>2. תוכן שנוצר ב-AI: חובה לבדוק</H>
      <P>
        תוכן שנוצר בבינה מלאכותית עלול להיות שגוי, חלקי או לא עדכני. זה כולל שעות פתיחה, מחירים, כתובות, מרחקים,
        כשרות של מסעדות, זמני שבת, דרישות ויזה וכניסה למדינות, והמלצות בריאות ובטיחות. לפני כל החלטה יש לבדוק את
        המידע מול המקור הרשמי (חברת התעופה, המלון, השגרירות, גוף הכשרות וכו'). השימוש בתוכן הוא באחריותכם בלבד.
      </P>

      <H>3. חשבון משתמש</H>
      <UL>
        <li>השירות מיועד לבני 18 ומעלה. פרטים של קטינים (למשל ילדים שמצטרפים לטיול) יוזנו רק על ידי הורה או אפוטרופוס.</li>
        <li>אתם אחראים לשמור על פרטי הכניסה שלכם ולכל פעולה שנעשית בחשבון.</li>
        <li>אפשר למחוק את החשבון בכל עת דרך מסך ההגדרות. המחיקה סופית.</li>
      </UL>

      <H>4. התוכן שלכם</H>
      <P>
        התוכן שאתם מעלים או יוצרים (טיולים, מסמכים, הערות) נשאר שלכם. אתם מעניקים לנו רשות לאחסן, לעבד ולהציג
        אותו רק במידה הנדרשת כדי לספק לכם את השירות, כולל שליחתו לספקי המשנה שמפורטים במדיניות הפרטיות.
      </P>
      <P>
        כשאתם מזינים פרטים של אנשים אחרים (משתתפים, דרכונים, מספרי הזמנה), אתם מצהירים שיש לכם רשות לעשות זאת
        ושיידעתם אותם על כך.
      </P>

      <H>5. קישור שיתוף</H>
      <P>
        כשאתם מפעילים שיתוף, כל מי שמחזיק בקישור יכול לצפות, בלי להתחבר, בשם הטיול, ביעד ובתאריכים, בטיסות (ללא
        מספרי הזמנה), בלינה, במסלול, בהמלצות, בעדכונים, בפרטי המדריך ובקישור לאלבום. משתתפים, מסמכים וצ'קליסט לא
        מוצגים. אתם אחראים למי שאתם שולחים אליו את הקישור. אפשר לבטל את השיתוף בכל רגע.
      </P>

      <H>6. שימוש אסור</H>
      <UL>
        <li>העלאת תוכן בלתי חוקי, פוגעני או מפר זכויות של אחרים.</li>
        <li>ניסיון לעקוף מגבלות שימוש (כולל המכסה היומית של ה-AI), לגשת למידע של משתמשים אחרים או לשבש את השירות.</li>
        <li>איסוף אוטומטי של מידע מהשירות (scraping) או שימוש בו לבניית שירות מתחרה.</li>
        <li>בדיקות אבטחה ללא אישור מראש ובכתב. מצאתם חולשה? נשמח לשמוע: <Email />.</li>
      </UL>
      <P>אנחנו רשאים להשעות או לסגור חשבון שמפר את התנאים.</P>

      <H>7. קניין רוחני</H>
      <P>
        השירות, הקוד, העיצוב, הלוגו והשם TripCraft שייכים ל-<V>{LEGAL.businessName}</V>. תמונות, מפות, גופנים
        וספריות קוד של צדדים שלישיים משמשים לפי הרישיונות שלהם, כמפורט בעמוד{" "}
        <Link to="/credits" className="text-primary underline underline-offset-2">קרדיטים ורישיונות</Link>.
      </P>

      <H>8. שירותים וקישורים של צד שלישי</H>
      <P>
        השירות מקשר ל-Google Maps, WhatsApp, ויקיפדיה, אתרי חברות תעופה ושירותים נוספים. אין לנו שליטה עליהם, והשימוש
        בהם כפוף לתנאים שלהם.
      </P>

      <H>9. זמינות ושינויים</H>
      <P>
        השירות ניתן כמות שהוא (AS IS) וכפי שהוא זמין. ייתכנו תקלות, השבתות ואובדן מידע, ולכן שמרו עותק של מסמכים
        חשובים גם מחוץ לשירות. אנחנו רשאים לשנות, להגביל או להפסיק את השירות או חלקים ממנו.
      </P>

      <H>10. הגבלת אחריות</H>
      <P>
        במידה המרבית שהחוק מתיר, לא נישא באחריות לנזק עקיף או תוצאתי, ובכלל זה טיסה שהוחמצה, הזמנה שבוטלה, הוצאה
        כספית או החלטה שהתקבלה על סמך תוכן בשירות, לרבות תוכן שנוצר ב-AI.
      </P>

      <H>11. שינויים בתנאים</H>
      <P>
        נעדכן את התנאים מעת לעת, ותאריך העדכון יופיע בראש העמוד. על שינוי מהותי נודיע באפליקציה או במייל. המשך השימוש
        לאחר העדכון מהווה הסכמה לתנאים המעודכנים.
      </P>

      <H>12. דין וסמכות שיפוט</H>
      <P>
        על התנאים חל הדין הישראלי בלבד. סמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים ב<V>{LEGAL.jurisdictionCity}</V>.
      </P>

      <H>13. יצירת קשר</H>
      <P>
        <V>{LEGAL.businessName}</V>, <V>{LEGAL.address}</V> · <Email />
      </P>
    </LegalLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="מדיניות פרטיות">
      <P>
        המדיניות מסבירה איזה מידע TripCraft אוסף, למה, עם מי הוא משותף ומה הזכויות שלכם. היא נכתבה בהתאם לחוק הגנת
        הפרטיות, התשמ"א-1981 (כולל תיקון 13) ולתקנות אבטחת מידע. בעל השליטה במאגר הוא <V>{LEGAL.businessName}</V>{" "}
        (<V>{LEGAL.businessId}</V>). לכל פנייה: <Email />.
      </P>
      <P>
        אין חובה חוקית למסור לנו מידע. בלי כתובת מייל לא ניתן לפתוח חשבון, ובלי פרטי הטיול השירות לא יכול לעבוד.
      </P>

      <H>1. איזה מידע נאסף</H>
      <UL>
        <li><strong>חשבון:</strong> כתובת מייל, שם, וסיסמה (שנשמרת מוצפנת ב-hash). בכניסה עם Google נקבל ממנה את השם והמייל שלכם.</li>
        <li><strong>פרטי הטיול:</strong> יעד, תאריכים, מסלול, טיסות (כולל מספרי הזמנה, מושבים ומטען), לינה, הסעות, הערות, פרטי מדריך, עדכונים וצ'קליסט.</li>
        <li><strong>משתתפים:</strong> שמות, גילים או טווחי גיל, והעדפות. העדפות עשויות לכלול כשרות, תזונה או צרכים מיוחדים, שהם מידע רגיש. ייתכן שחלק מהמשתתפים קטינים.</li>
        <li><strong>מסמכים:</strong> קבצים שאתם מעלים (דרכונים, כרטיסי טיסה, שוברים, ביטוחים) נשמרים באחסון פרטי, והגישה אליהם אפשרית רק מהחשבון שלכם.</li>
        <li><strong>סריקות:</strong> תמונות של דרכונים ושוברים נשלחות לעיבוד AI כדי לחלץ מהן פרטים. תמונת דרכון לא נשמרת אצלנו, אלא אם בחרתם להעלות אותה גם ללשונית המסמכים.</li>
        <li><strong>צ'אט:</strong> השאלות שלכם, תשובות העוזר וההקשר של הטיול שנשלח איתן.</li>
        <li><strong>נתוני שימוש טכניים:</strong> כמות שימוש ב-AI, זמני תגובה ושגיאות, לצורך בקרת עלויות ותקלות. אין אצלנו פרסומות, פיקסלים או כלי אנליטיקה של צד שלישי.</li>
      </UL>

      <H>2. למה אנחנו משתמשים במידע</H>
      <UL>
        <li>כדי לספק את השירות: לשמור ולהציג את הטיול, ליצור המלצות ומסלולים ולענות בצ'אט.</li>
        <li>כדי לשלוח הודעות שירות, כמו תזכורת לפני יציאה לטיול, לכתובת המייל של החשבון.</li>
        <li>לאבטחה, למניעת שימוש לרעה, לבקרת עלויות ולתיקון תקלות.</li>
      </UL>
      <P>אנחנו לא מוכרים מידע, לא משתמשים בו לפרסום ולא בונים ממנו פרופיל שיווקי.</P>

      <H>3. עם מי המידע משותף</H>
      <P>רק עם ספקים שנדרשים להפעלת השירות, ובמידה הנדרשת בלבד:</P>
      <UL>
        <li><strong>Supabase:</strong> מסד הנתונים, ההתחברות ואחסון הקבצים. אזור האחסון: <V>{LEGAL.hostingRegion}</V>.</li>
        <li><strong>Vercel:</strong> אירוח האפליקציה.</li>
        <li><strong>Anthropic (Claude):</strong> עיבוד AI של בקשות, צ'אט וסריקות. לפי התנאים המסחריים שלה, היא לא משתמשת בתוכן שנשלח דרך ה-API שלה כדי לאמן מודלים.</li>
        <li><strong>Voyage AI:</strong> עיבוד טקסט של חלק מהשאלות בצ'אט, לצורך חיפוש במאגר הידע (למשל כשרות).</li>
        <li><strong>Google:</strong> התחברות עם Google, אם בחרתם בה, וטעינת גופנים (Google Fonts).</li>
        <li><strong>ויקיפדיה ו-OpenStreetMap:</strong> שמות מקומות נשלחים מהשרת שלנו כדי למצוא תמונה וקואורדינטות. אריחי המפה נטענים ישירות מ-OpenStreetMap, ולכן כתובת ה-IP שלכם נחשפת אליה.</li>
        <li><strong>שירות מייל:</strong> לשליחת הודעות שירות.</li>
      </UL>
      <P>
        חלק מהספקים שומרים ומעבדים מידע מחוץ לישראל. ההעברה נעשית לספקים שמחויבים לשמור על המידע ולהשתמש בו רק לצורך
        מתן השירות. נמסור מידע לרשויות רק אם נחויב לכך על פי דין.
      </P>

      <H>4. קישור שיתוף</H>
      <P>
        כשאתם משתפים טיול, כל מי שמחזיק בקישור רואה את שם הטיול, היעד והתאריכים, טיסות (ללא מספרי הזמנה), לינה, מסלול,
        המלצות, עדכונים, את השם והטלפון של המדריך ואת הקישור לאלבום. <strong>משתתפים, מסמכים וצ'קליסט לא מוצגים
        בקישור.</strong> אפשר לבטל את השיתוף בכל רגע.
      </P>

      <H>5. אבטחת מידע</H>
      <P>
        המידע מוצפן בזמן ההעברה (HTTPS). הגישה לכל טבלה מוגבלת ברמת השורה לבעלי הטיול בלבד, והמסמכים נשמרים באחסון
        פרטי שנפתח רק דרך קישור זמני. אין מערכת מאובטחת במאה אחוז. אם נגלה אירוע אבטחה שפוגע במידע שלכם, נודיע לכם
        ולרשות להגנת הפרטיות כנדרש בחוק.
      </P>

      <H>6. שמירה ומחיקה</H>
      <P>
        המידע נשמר כל עוד החשבון פעיל. מחיקת טיול מוחקת את כל הנתונים שלו. מחיקת חשבון (בהגדרות) מוחקת את החשבון, את
        כל הטיולים, את המסמכים ואת היסטוריית השימוש. גיבויים של ספק האחסון נמחקים באופן מחזורי תוך{" "}
        <V>{LEGAL.backupRetention}</V> ימים.
      </P>

      <H>7. הזכויות שלכם</H>
      <UL>
        <li>לעיין במידע שנשמר עליכם.</li>
        <li>לבקש לתקן מידע שגוי. את רוב המידע אפשר לתקן ישירות באפליקציה.</li>
        <li>למחוק את החשבון ואת כל המידע, דרך ההגדרות או בפנייה אלינו.</li>
        <li>לחזור בכם מהסכמה לעיבוד, כמו הפסקת השימוש בסריקות AI.</li>
      </UL>
      <P>
        נשיב לפנייה ל-<Email /> תוך 30 יום. אם אינכם מרוצים מהטיפול, אפשר לפנות לרשות להגנת הפרטיות במשרד המשפטים.
      </P>

      <H>8. קטינים</H>
      <P>
        השירות מיועד לבני 18 ומעלה. פרטים של קטינים מוזנים רק על ידי הורה או אפוטרופוס, שאחראי לכך ויכול למחוק אותם
        בכל עת.
      </P>

      <H>9. אחסון בדפדפן</H>
      <P>
        אנחנו שומרים בדפדפן רק את מה שנדרש כדי שהשירות יעבוד: אסימון ההתחברות (כדי שלא תצטרכו להתחבר כל פעם)
        והעדפת מצב כהה. אין עוגיות פרסום או מעקב.
      </P>

      <H>10. שינויים במדיניות</H>
      <P>
        נעדכן את המדיניות לפי הצורך, ותאריך העדכון יופיע בראש העמוד. על שינוי מהותי נודיע באפליקציה או במייל.
      </P>
    </LegalLayout>
  );
}

export function CreditsPage() {
  const libs: [string, string][] = [
    ["React, React DOM", "MIT"],
    ["React Router", "MIT"],
    ["Supabase JS", "MIT"],
    ["Leaflet", "BSD-2-Clause"],
    ["React Leaflet", "Hippocratic License 2.1"],
    ["Lucide (אייקונים)", "ISC"],
    ["SheetJS (קריאת קבצי Excel)", "Apache-2.0"],
    ["Tailwind CSS", "MIT"],
    ["clsx, tailwind-merge", "MIT"],
  ];
  return (
    <LegalLayout title="קרדיטים ורישיונות">
      <H>תמונות</H>
      <P>
        תמונות המקומות מגיעות מ<a href="https://www.wikipedia.org" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">ויקיפדיה</a>{" "}
        ומ-<a href="https://commons.wikimedia.org" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Wikimedia Commons</a>.
        כל תמונה מופצת לפי הרישיון שלה, בדרך כלל CC BY-SA, CC BY או נחלת הכלל. שם היוצר והרישיון המלא מופיעים בעמוד
        התמונה, שנפתח בלחיצה על סימן ⓘ שמופיע על כל תמונה. היוצרים אינם קשורים ל-TripCraft ואינם ממליצים עליו.
      </P>

      <H>מפות ומיקומים</H>
      <P>
        נתוני המפה © תורמי{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">OpenStreetMap</a>,
        ברישיון ODbL. איתור המיקומים נעשה באמצעות Nominatim.
      </P>

      <H>גופנים</H>
      <P>Heebo ו-Rubik, ברישיון SIL Open Font License 1.1, דרך Google Fonts.</P>

      <H>בינה מלאכותית</H>
      <P>התכנים החכמים מופעלים על ידי Claude של Anthropic. חיפוש במאגר הידע נעשה באמצעות Voyage AI.</P>

      <H>ספריות קוד פתוח</H>
      <ul className="mb-2 divide-y divide-border rounded-2xl border border-border">
        {libs.map(([name, license]) => (
          <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>{name}</span>
            <span dir="ltr" className="text-xs text-muted-foreground">{license}</span>
          </li>
        ))}
      </ul>

      <H>סימני מסחר</H>
      <P>
        Google, Google Maps, WhatsApp, Wikipedia, OpenStreetMap ו-Claude הם סימני מסחר של בעליהם. השימוש בשמות נועד רק
        לתאר את השירות ואינו מעיד על שותפות או חסות.
      </P>
    </LegalLayout>
  );
}

export function AccessibilityPage() {
  return (
    <LegalLayout title="הצהרת נגישות">
      <P>
        אנחנו רוצים ש-TripCraft יהיה נוח לכל אחד ואחת, כולל אנשים עם מוגבלות, ופועלים להתאים אותו לתקן הישראלי 5568
        (שמבוסס על WCAG 2.0 ברמה AA) ולתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013.
      </P>

      <H>מה כבר נעשה</H>
      <UL>
        <li>ממשק בעברית מימין לשמאל, עם שפת עמוד מוגדרת.</li>
        <li>התאמה לגדלי מסך של טלפון, טאבלט ומחשב, ותמיכה בהגדלת טקסט בדפדפן.</li>
        <li>מצב כהה לבחירה.</li>
        <li>תוויות לקוראי מסך על כפתורים שיש בהם רק אייקון.</li>
        <li>תמונות מקבלות טקסט חלופי עם שם המקום.</li>
      </UL>

      <H>מגבלות ידועות</H>
      <UL>
        <li>המפה האינטראקטיבית לא נגישה במלואה במקלדת ובקורא מסך. כל המידע שבה מופיע גם ברשימה שמתחתיה.</li>
        <li>תוכן שנוצר ב-AI ומסמכים שמשתמשים מעלים אינם בשליטתנו המלאה.</li>
        <li>עדיין לא בוצעה בדיקת נגישות מלאה על ידי מורשה נגישות.</li>
      </UL>

      <H>נתקלתם בבעיה?</H>
      <P>
        נשמח לשמוע ולתקן. רכז/ת הנגישות: <V>{LEGAL.accessibilityContact}</V> · <Email />. כדאי לציין את העמוד, מה ניסיתם
        לעשות ובאיזה מכשיר ודפדפן השתמשתם.
      </P>
    </LegalLayout>
  );
}
