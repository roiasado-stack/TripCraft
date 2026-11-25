import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  FileText,
  FileUp,
  LogIn,
  Play,
  Sparkles,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalLinks } from "@/components/LegalLinks";
import { Card, buttonClass } from "@/components/ui";
import { LandingExample, LandingProof } from "@/components/LandingExample";
import { AgentDemoForm } from "@/components/AgentDemoForm";
import { cn } from "@/lib/utils";
import { LEGAL } from "@/lib/legal";
import { track } from "@/lib/analytics";

/*
 * Public landing page: what a signed-out visitor sees on `/`. Google's OAuth
 * branding review needs the consent screen's homepage to explain the app and
 * link to the privacy policy and terms before anyone is asked to sign in.
 * Everything here is static — no Supabase reads, no assumption of a session.
 */

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FileUp,
    title: "העלאת הזמנה וקבלת טיול מוכן",
    text: "מעלים PDF או צילום מסך של אישור הזמנה, ומקבלים טיול מסודר עם כל התאריכים והשעות.",
  },
  {
    icon: CalendarDays,
    title: "מסלול יום אחר יום",
    text: "תוכנית לכל יום עם מקומות, שעות וקישורי ניווט - או מסלול מוכן שנבנה לפי הטיסות והמלון שלכם.",
  },
  {
    icon: UtensilsCrossed,
    title: "כשרות ושבת",
    text: "מקומות אוכל כשרים ובתי חב״ד ליד היעד, עם סימון ברור של מה מאומת ומה לא, וזמני שבת וחג ביעד.",
  },
  {
    icon: Sparkles,
    title: "עוזר חכם בעברית",
    text: "שואלים כל שאלה על הטיול - מה מחר, איפה המלון, מתי הטיסה - ומקבלים תשובה לפי התוכנית שלכם.",
  },
  {
    icon: FileText,
    title: "מסמכים וצ'קליסט",
    text: "דרכונים, ביטוחים וכרטיסים נשמרים באופן פרטי, לצד רשימת הכנות לקראת הטיסה.",
  },
  {
    icon: Users,
    title: "כל המטיילים מעודכנים",
    text: "מזמינים בני משפחה וחברים בקישור. כל אחד רואה את הטיול בטלפון שלו, לפי ההרשאה שקיבל.",
  },
];

/*
 * Hero demo video. Drop the file at public/demo/hero.mp4 (and an optional poster at
 * public/demo/hero-poster.webp), then set the paths below. While HERO_VIDEO_SRC is empty
 * the hero shows a neutral placeholder in the same 16:9 slot.
 */
const HERO_VIDEO_SRC = "";
const HERO_VIDEO_POSTER = "";
/* Until a self-hosted file exists, the demo plays from YouTube (privacy-enhanced domain, loaded only on click). */
const HERO_YOUTUBE_ID = "ttd5gtI_jbU";

/* Where the main CTAs go. Sign in / sign up first, then straight into the new-trip wizard. */
const CREATE_TRIP_HREF = "/auth?next=/new";
/* Agent demo request form (built on /agents in a later step) and the public sample trip page. */
const AGENT_DEMO_HREF = "/agents#demo";
const SAMPLE_TRIP_HREF = "/sample-trip";

type Audience = "traveler" | "agent";

const AUDIENCE_TABS: { value: Audience; label: string }[] = [
  { value: "traveler", label: "אני מטייל" },
  { value: "agent", label: "אני סוכן נסיעות" },
];

const TRAVELER_BULLETS = [
  "העלאת הזמנה ← טיול מוכן בדקה",
  "מסלול יום אחר יום מותאם להרכב שלכם",
  "כשרות ושבת - מסעדות, בתי חב״ד, זמני כניסת שבת",
  "סוכן AI בעברית שעונה על שאלות לפי הטיול שלכם",
];

const AGENT_BULLETS = [
  "העלאת הזמנה קיימת ← טיול מוכן בדקה",
  "מיתוג מלא עם לוגו הסוכנות",
  "הלקוח רואה הכל במקום אחד - פחות שאלות אליכם",
  "סוכן AI שעונה על שאלות לפי הטיול הספציפי",
];

/** An installed app (home-screen icon) opens straight on the login screen, not on the brochure. */
function isInstalledApp() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * `/` shows the traveller view by default (`?audience=agent` switches it); `/agents` is the same
 * page with the agent view fixed, so agencies get a link of their own.
 */
export default function LandingPage({ agentsPage = false }: { agentsPage?: boolean }) {
  if (isInstalledApp()) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden bg-gradient-surf">
        {/* decorative sun blobs */}
        <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-[var(--sun)] opacity-30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full bg-accent opacity-20 blur-3xl" />

        <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
          <BrandLogo size="sm" />
          <Link
            to="/auth"
            className="-me-2 px-2 py-2 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            כניסה
          </Link>
        </header>

        <section className="relative mx-auto max-w-3xl px-4 pb-14 pt-10 text-center sm:px-6 md:pb-20 md:pt-14">
          <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            העליתם הזמנה?
            <span className="block text-primary">קיבלתם טיול שלם.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-[17px] leading-relaxed text-muted-foreground">
            מעלים PDF או צילום מסך של ההזמנה, <span className="whitespace-nowrap">ו-TripCraft</span> בונה מסלול יום-אחר-יום בעברית - טיסות, מלון, כשרות,
            שבת, מסעדות, אטרקציות וסוכן AI שעונה על הכל.
          </p>
          <Link
            to={CREATE_TRIP_HREF}
            onClick={() => track("click_create_trip", { location: "hero" })}
            className={buttonClass("primary", "lg", "mt-7 w-full sm:w-auto")}
          >
            צרו את הטיול שלי בחינם
            <ArrowLeft className="ms-2 size-5" />
          </Link>
          <p className="mt-3 text-balance text-sm text-muted-foreground">
            בלי כרטיס אשראי • בעברית מלאה • מתאים לשומרי כשרות ושבת
          </p>

          <HeroVideo />
        </section>
      </div>

      <AudienceSection agentsPage={agentsPage} />
      {agentsPage && <AgentDemoForm />}
      <LandingExample />
      <LandingProof />

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
          <nav aria-label="קישורים" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[15px] font-semibold">
            <Link
              to={CREATE_TRIP_HREF}
              onClick={() => track("click_create_trip", { location: "footer" })}
              className="hover:text-primary"
            >
              צור טיול
            </Link>
            <Link to="/agents" className="hover:text-primary">
              לסוכני נסיעות
            </Link>
            <a href="#example" className="hover:text-primary">
              דוגמה לטיול
            </a>
          </nav>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            אפשר להיכנס עם מייל וסיסמה או עם חשבון Google. בכניסה עם Google אנחנו מקבלים ממנה רק את השם וכתובת
            המייל שלכם, כדי ליצור את החשבון. אנחנו לא מוכרים מידע ולא משתמשים בו לפרסום.
          </p>
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

/** Traveller / travel-agent switch right under the hero. The choice lives in the URL (?audience=). */
function AudienceSection({ agentsPage }: { agentsPage: boolean }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const audience: Audience = agentsPage || params.get("audience") === "agent" ? "agent" : "traveler";

  function choose(next: Audience) {
    if (next === audience) return;
    track(next === "agent" ? "toggle_audience_agent" : "toggle_audience_traveler");
    if (agentsPage) {
      navigate({ pathname: "/", search: `?audience=${next}` });
      return;
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("audience", next);
    setParams(nextParams, { replace: true });
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
      <div
        role="tablist"
        aria-label="למי האתר מיועד"
        className="mx-auto flex max-w-md gap-1.5 rounded-3xl bg-muted p-1.5"
      >
        {AUDIENCE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`audience-tab-${tab.value}`}
            aria-selected={audience === tab.value}
            aria-controls="audience-panel"
            onClick={() => choose(tab.value)}
            className={cn(
              "h-14 flex-1 rounded-2xl px-3 font-display text-base font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              audience === tab.value ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="audience-panel" role="tabpanel" aria-labelledby={`audience-tab-${audience}`} className="mt-6">
        <Card className="p-6 sm:p-8">
          {audience === "traveler" ? (
            <>
              <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
                הטיול שלכם, מסודר סוף סוף.
              </h2>
              <BulletList items={TRAVELER_BULLETS} />
              <Link
                to={CREATE_TRIP_HREF}
                onClick={() => track("click_create_trip", { location: "audience_panel" })}
                className={buttonClass("primary", "lg", "mt-6 w-full sm:w-auto")}
              >
                צרו את הטיול שלי בחינם
                <ArrowLeft className="ms-2 size-5" />
              </Link>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
                הפכו כל הזמנה לטיול ממותג של הסוכנות שלכם, בלחיצת כפתור.
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted-foreground">
                הלקוח שלכם מקבל אפליקציה עם הלוגו שלכם, עם כל הטיול, המסמכים, הצ׳קליסט וסוכן AI שעונה בשמכם. פחות
                טלפונים, יותר רושם מקצועי.
              </p>
              <BulletList items={AGENT_BULLETS} />
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={AGENT_DEMO_HREF}
                  onClick={() => track("click_agent_demo", { location: "audience_panel" })}
                  className={buttonClass("primary", "lg", "w-full sm:w-auto")}
                >
                  קבעו הדגמה של 15 דקות
                </Link>
                <Link to={SAMPLE_TRIP_HREF} className={buttonClass("outline", "lg", "w-full sm:w-auto")}>
                  צפו בדוגמה של טיול לקוח
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {items.map((text) => (
        <li key={text} className="flex items-start gap-3 text-[16px] leading-relaxed">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            <Check className="size-4" />
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Muted autoplay demo (controls = play/pause) or, until the file exists, an empty 16:9 placeholder. */
function HeroVideo() {
  return (
    <div className="mx-auto mt-10 w-full max-w-2xl">
      {HERO_VIDEO_SRC ? (
        <video
          className="aspect-video w-full rounded-3xl border border-border bg-card shadow-pop"
          src={HERO_VIDEO_SRC}
          poster={HERO_VIDEO_POSTER || undefined}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
        />
      ) : (
        <YouTubeDemo />
      )}
    </div>
  );
}

/** Nothing is requested from YouTube until the visitor presses play. */
function YouTubeDemo() {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <iframe
        className="aspect-video w-full rounded-3xl border border-border bg-card shadow-pop"
        src={`https://www.youtube-nocookie.com/embed/${HERO_YOUTUBE_ID}?autoplay=1&rel=0`}
        title="סרטון הדגמה של TripCraft"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="grid aspect-video w-full place-items-center rounded-3xl border border-border bg-card shadow-pop transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="הפעלת סרטון ההדגמה"
    >
      <span className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
        <Play className="size-7" />
      </span>
    </button>
  );
}
