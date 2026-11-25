import { useState } from "react";
import { BedDouble, Flame, Landmark, Plane, Quote, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { LANDING_STATS, LANDING_TESTIMONIALS } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

/*
 * Landing sections that show the product instead of describing it: a sample trip with day tabs,
 * the testimonials and the stats row. The trip is a made-up illustration, not real data.
 */

interface ExampleRow {
  icon: LucideIcon;
  time: string;
  title: string;
  sub: string;
}

export const EXAMPLE_DAYS: { label: string; weekday: string; rows: ExampleRow[]; shabbat?: string }[] = [
  {
    label: "יום 1",
    weekday: "יום רביעי",
    rows: [
      { icon: Plane, time: "06:10", title: "טיסה לרומא", sub: "נתב״ג ← רומא FCO" },
      { icon: BedDouble, time: "11:30", title: "צ׳ק-אין במלון", sub: "חדר משפחתי · 4 מטיילים" },
      { icon: Landmark, time: "15:00", title: "הקולוסיאום", sub: "ביקור של שעתיים" },
      { icon: UtensilsCrossed, time: "19:30", title: "ארוחת ערב כשרה", sub: "ברובע היהודי" },
    ],
  },
  {
    label: "יום 2",
    weekday: "יום חמישי",
    rows: [
      { icon: Landmark, time: "10:00", title: "הוותיקן", sub: "סיור של 3 שעות" },
      { icon: UtensilsCrossed, time: "13:30", title: "ארוחת צהריים כשרה", sub: "קרוב לאטרקציה" },
      { icon: BedDouble, time: "21:00", title: "חזרה למלון", sub: "הלילה האחרון ברומא" },
    ],
  },
  {
    label: "יום 3",
    weekday: "יום שישי",
    rows: [
      { icon: UtensilsCrossed, time: "08:00", title: "ארוחת בוקר כשרה", sub: "במלון" },
      { icon: Landmark, time: "09:30", title: "מזרקת טרווי", sub: "סיבוב קצר לפני הטיסה" },
      { icon: Plane, time: "13:10", title: "טיסה חזרה", sub: "רומא FCO ← נתב״ג" },
    ],
    shabbat: "16:21",
  },
];

/** One day's rows (and the Shabbat entry on a Friday). Shared by the landing example and /sample-trip. */
export function ExampleRows({ day }: { day: (typeof EXAMPLE_DAYS)[number] }) {
  return (
    <ul className="mt-3 divide-y divide-separator">
      {day.rows.map(({ icon: Icon, time, title, sub }) => (
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
      {day.shabbat && (
        <li className="flex items-center gap-3 py-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sun text-sun-foreground">
            <Flame className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">כניסת שבת</p>
            <p className="text-sm text-muted-foreground">זמני שבת מוצגים ביום שישי</p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{day.shabbat}</span>
        </li>
      )}
    </ul>
  );
}

export function LandingExample() {
  const [day, setDay] = useState(0);
  const current = EXAMPLE_DAYS[day];

  return (
    <section id="example" className="mx-auto max-w-3xl scroll-mt-4 px-4 pt-14 sm:px-6">
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">ככה נראה טיול ב-TripCraft</h2>
      <p className="mt-2 font-semibold">3 ימים ברומא, זוג + 2 ילדים, כשר</p>

      <Card className="mt-5 p-4 sm:p-6">
        <div role="tablist" aria-label="ימי הטיול" className="flex gap-1.5 rounded-2xl bg-muted p-1.5">
          {EXAMPLE_DAYS.map((d, i) => (
            <button
              key={d.label}
              type="button"
              role="tab"
              id={`example-tab-${i}`}
              aria-selected={day === i}
              aria-controls="example-panel"
              onClick={() => setDay(i)}
              className={cn(
                "h-12 flex-1 rounded-xl px-2 font-display text-[15px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                day === i ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div id="example-panel" role="tabpanel" aria-labelledby={`example-tab-${day}`} className="mt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {current.label} · רומא
              </p>
              <p className="mt-0.5 font-display text-lg font-bold">{current.weekday}</p>
            </div>
            {current.shabbat && <Badge tone="sun">כניסת שבת {current.shabbat}</Badge>}
          </div>
          <ExampleRows day={current} />
        </div>
      </Card>
      <p className="mt-3 text-center text-xs text-muted-foreground">דוגמה להמחשה</p>
    </section>
  );
}

export function LandingProof() {
  // A stat with no value yet is left out rather than shown empty.
  const stats = [
    { value: LANDING_STATS.tripsBuilt, label: "טיולים כבר נבנו" },
    { value: LANDING_STATS.agencies, label: "סוכנויות עובדות איתנו" },
    { value: LANDING_STATS.rating, label: "דירוג מטיילים" },
  ].filter((s) => s.value.trim() !== "");
  const statCols = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3"][stats.length];

  if (LANDING_TESTIMONIALS.length === 0 && stats.length === 0) return null;

  return (
    <section className="mx-auto max-w-3xl px-4 pt-14 sm:px-6">
      {LANDING_TESTIMONIALS.length > 0 && (
        <>
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">מה אומרים עלינו</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {LANDING_TESTIMONIALS.map(({ quote, author }) => (
          <Card key={author} className="flex flex-col p-5">
            <Quote className="size-5 text-primary" aria-hidden="true" />
            <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed">“{quote}”</blockquote>
            <p className="mt-4 text-sm font-semibold text-muted-foreground">{author}</p>
          </Card>
        ))}
      </div>
        </>
      )}

      {stats.length > 0 && (
      <dl className={cn(LANDING_TESTIMONIALS.length > 0 ? "mt-8 grid gap-2 text-center" : "grid gap-2 text-center", statCols)}>
        {stats.map(({ value, label }) => (
          <div key={label} className="rounded-2xl bg-muted px-2 py-4">
            <dt className="sr-only">{label}</dt>
            <dd dir="ltr" className="font-display text-2xl font-extrabold text-primary sm:text-3xl">
              {value}
            </dd>
            <p aria-hidden="true" className="mt-1 text-xs font-semibold text-muted-foreground sm:text-sm">
              {label}
            </p>
          </div>
        ))}
      </dl>
      )}
    </section>
  );
}
