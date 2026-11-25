import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { EXAMPLE_DAYS, ExampleRows } from "@/components/LandingExample";
import { Badge, Card, buttonClass } from "@/components/ui";

/*
 * Public sample trip for travel agents: what their client would see. Static and made up (the same
 * Rome example as the landing page), no login, no Supabase.
 */
export default function SampleTripPage() {
  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 pt-4">
        <BrandLogo size="sm" />
        <Link
          to="/agents"
          className="-me-2 inline-flex items-center gap-1 px-2 py-2 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowRight className="size-4" />
          חזרה
        </Link>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">3 ימים ברומא, זוג + 2 ילדים, כשר</h1>
        <p className="mt-1 text-sm text-muted-foreground">דוגמה להמחשה</p>

        <div className="mt-5 space-y-4">
          {EXAMPLE_DAYS.map((day) => (
            <Card key={day.label} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">{day.label} · רומא</p>
                  <h2 className="mt-0.5 font-display text-lg font-bold">{day.weekday}</h2>
                </div>
                {day.shabbat && <Badge tone="sun">כניסת שבת {day.shabbat}</Badge>}
              </div>
              <ExampleRows day={day} />
            </Card>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <Link to="/agents#demo" className={buttonClass("primary", "lg", "w-full")}>
            קבעו הדגמה של 15 דקות
          </Link>
        </div>
      </main>
    </div>
  );
}
