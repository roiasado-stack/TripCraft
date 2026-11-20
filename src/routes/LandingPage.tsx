import { Link, Navigate } from "react-router-dom";
import {
  BedDouble,
  Briefcase,
  CalendarDays,
  FileText,
  LogIn,
  Plane,
  ShieldCheck,
  Sparkles,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalLinks } from "@/components/LegalLinks";
import { Badge, Card, buttonClass } from "@/components/ui";
import { LEGAL } from "@/lib/legal";

/*
 * Public landing page: what a signed-out visitor sees on `/`. Google's OAuth
 * branding review needs the consent screen's homepage to explain the app and
 * link to the privacy policy and terms before anyone is asked to sign in.
 * Everything here is static — no Supabase reads, no assumption of a session.
 */

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Plane,
    title: "טיסות ולינה במקום אחד",
    text: "מעלים אישור הזמנה (PDF או צילום מסך), והטיסות והמלונות מסודרים בטיול עם התאריכים והשעות.",
  },
  {
    icon: CalendarDays,
    title: "מסלול יום אחר יום",
    text: "תוכנית לכל יום עם מקומות, שעות וקישורי ניווט — או מסלול מוצע שנבנה לפי הטיסות והלינה שלכם.",
  },
  {
    icon: Users,
    title: "כל המטיילים מעודכנים",
    text: "מזמינים בני משפחה וחברים בקישור. כל אחד רואה את הטיול בטלפון שלו, לפי ההרשאה שקיבל.",
  },
  {
    icon: FileText,
    title: "מסמכים וצ'קליסט",
    text: "דרכונים, ביטוחים וכרטיסים נשמרים באופן פרטי, לצד רשימת הכנות לקראת הטיסה.",
  },
  {
    icon: UtensilsCrossed,
    title: "כשרות ושבת",
    text: "מקומות אוכל כשרים ובתי חב״ד ליד היעד, עם סימון ברור של מה מאומת ומה לא, וזמני שבת וחג ביעד.",
  },
  {
    icon: Sparkles,
    title: "עוזר חכם בעברית",
    text: "שואלים כל שאלה על הטיול — מה מחר, איפה המלון, מתי הטיסה — ומקבלים תשובה לפי התוכנית שלכם.",
  },
];

/** An installed app (home-screen icon) opens straight on the login screen, not on the brochure. */
function isInstalledApp() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export default function LandingPage() {
  if (isInstalledApp()) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden bg-gradient-surf">
        {/* decorative sun blobs */}
        <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-[var(--sun)] opacity-30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full bg-accent opacity-20 blur-3xl" />

        <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
          <BrandLogo size="sm" />
          <Link to="/auth" className={buttonClass("outline", "sm")}>
            <LogIn className="size-4" />
            כניסה
          </Link>
        </header>

        <section className="relative mx-auto grid max-w-5xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-2 md:pb-20 md:pt-16">
          <div>
            <Badge tone="primary">בעברית · לטיולים בחו״ל</Badge>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              כל הטיול שלכם, <span className="text-primary">במקום אחד</span>
            </h1>
            <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
              TripCraft היא אפליקציה בעברית לתכנון וניהול טיולים: טיסות, לינה, מסלול יומי, מסמכים ומשתתפים —
              מסודרים במקום אחד ונגישים מהטלפון של כל המטיילים, לפני הטיול ובמהלכו.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to="/auth" className={buttonClass("primary", "lg")}>
                <LogIn className="size-5" />
                כניסה / הרשמה
              </Link>
              <a href="#features" className={buttonClass("ghost", "lg")}>
                מה יש באפליקציה
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">אפשר להיכנס עם מייל וסיסמה או עם חשבון Google.</p>
          </div>

          <TripPreview />
        </section>
      </div>

      <section id="features" className="mx-auto max-w-5xl scroll-mt-4 px-4 py-14 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">מה עושים ב-TripCraft</h2>
        <p className="mt-2 text-muted-foreground">כל מה שצריך לטיול, מההזמנה הראשונה ועד הטיסה חזרה.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-5">
              <div className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <Card className="p-6">
          <div className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Briefcase className="size-5" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold">לסוכנויות נסיעות</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            סביבת עבודה לסוכן: בונים את הטיול של הלקוח מתוך מסמכי ההזמנה, בודקים, ושולחים לו קישור לאפליקציה עם
            הלוגו של הסוכנות.
          </p>
          <p className="mt-3 text-[15px]">
            רוצים לשמוע עוד?{" "}
            <a href={`mailto:${LEGAL.contactEmail}`} dir="ltr" className="font-semibold text-primary underline underline-offset-2">
              {LEGAL.contactEmail}
            </a>
          </p>
        </Card>

        <Card className="p-6">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold">התחברות ופרטיות</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            אפשר להיכנס עם מייל וסיסמה או עם חשבון Google. בכניסה עם Google אנחנו מקבלים ממנה רק את השם וכתובת
            המייל שלכם, כדי ליצור את החשבון. אנחנו לא מוכרים מידע ולא משתמשים בו לפרסום.
          </p>
          <p className="mt-3 text-[15px]">
            הפרטים המלאים ב
            <Link to="/privacy" className="font-semibold text-primary underline underline-offset-2">
              מדיניות הפרטיות
            </Link>{" "}
            וב
            <Link to="/terms" className="font-semibold text-primary underline underline-offset-2">
              תנאי השימוש
            </Link>
            .
          </p>
        </Card>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 text-center sm:px-6">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">מוכנים לטיול הבא?</h2>
        <p className="mt-2 text-muted-foreground">נכנסים, יוצרים טיול ומזמינים את כל מי שנוסע.</p>
        <Link to="/auth" className={buttonClass("primary", "lg", "mt-6")}>
          <LogIn className="size-5" />
          כניסה / הרשמה
        </Link>
      </section>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-8 text-center sm:px-6">
          <BrandLogo size="sm" />
          <LegalLinks className="gap-x-5 gap-y-2 text-sm font-semibold" />
          <a href={`mailto:${LEGAL.contactEmail}`} dir="ltr" className="text-sm text-muted-foreground underline underline-offset-2">
            {LEGAL.contactEmail}
          </a>
          <p dir="ltr" className="text-xs text-muted-foreground">© {new Date().getFullYear()} TripCraft</p>
        </div>
      </footer>
    </div>
  );
}

/** Illustration of one trip day — made-up sample, not real data. */
function TripPreview() {
  const rows: { icon: LucideIcon; time: string; title: string; sub: string }[] = [
    { icon: Plane, time: "06:10", title: "טיסה לרומא", sub: "נתב״ג ← רומא FCO" },
    { icon: BedDouble, time: "11:30", title: "צ׳ק-אין במלון", sub: "2 חדרים · 5 מטיילים" },
    { icon: UtensilsCrossed, time: "13:00", title: "ארוחת צהריים כשרה", sub: "ברובע היהודי" },
  ];
  return (
    <figure className="mx-auto w-full max-w-sm">
      <Card className="p-5 shadow-pop" aria-hidden="true">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">יום 1 · רומא</p>
            <p className="mt-0.5 font-display text-lg font-bold">יום שישי</p>
          </div>
          <Badge tone="sun">כניסת שבת 16:21</Badge>
        </div>
        <ul className="mt-4 divide-y divide-separator">
          {rows.map(({ icon: Icon, time, title, sub }) => (
            <li key={title} className="flex items-center gap-3 py-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted-foreground">{sub}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">{time}</span>
            </li>
          ))}
        </ul>
      </Card>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">דוגמה ליום בטיול</figcaption>
    </figure>
  );
}
