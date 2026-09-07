import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AgentRun } from "@/lib/types";
import { Badge, Card, EmptyState, FullSpinner } from "@/components/ui";

// Visible warning on this screen when today's total spend crosses this —
// separate from DAILY_CAP_USD in the Edge Functions, which blocks a single
// user's calls. This one is app-wide, for Roi to notice before it matters.
const ALERT_THRESHOLD_USD = 5;

const KIND_LABEL: Record<string, string> = {
  ask: "שאל את הסוכן",
  generate_suggestions: "יצירת המלצות",
  generate_itinerary: "יצירת מסלול",
  generate_checklist: "יצירת צ'קליסט",
  generate_passports: "סריקת דרכונים",
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AdminMonitoringPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("agent_runs")
        .select("*")
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: false })
        .limit(500);
      if (!active) return;
      setRuns((data as AgentRun[]) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <FullSpinner label="טוענים נתוני שימוש…" />;

  const totalCost = runs.reduce((s, r) => s + Number(r.cost_usd), 0);
  const errors = runs.filter((r) => r.status === "error");
  const errorRate = runs.length ? errors.length / runs.length : 0;

  const byKind = new Map<string, { count: number; cost: number; errors: number }>();
  for (const r of runs) {
    const entry = byKind.get(r.kind) ?? { count: 0, cost: 0, errors: 0 };
    entry.count += 1;
    entry.cost += Number(r.cost_usd);
    if (r.status === "error") entry.errors += 1;
    byKind.set(r.kind, entry);
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      <header className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate("/settings")} className="grid size-10 place-items-center rounded-2xl border border-border bg-card" aria-label="חזרה">
          <ChevronRight className="size-5" />
        </button>
        <h1 className="text-xl font-extrabold">מוניטורינג · היום</h1>
      </header>

      {totalCost >= ALERT_THRESHOLD_USD && (
        <Card className="mb-4 flex items-center gap-3 border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <p className="text-sm font-semibold text-destructive">
            העלות היומית (${totalCost.toFixed(2)}) חצתה את הסף (${ALERT_THRESHOLD_USD}).
          </p>
        </Card>
      )}

      {runs.length === 0 ? (
        <EmptyState emoji="📊" title="אין קריאות היום" description="ברגע שמישהו ישתמש בסוכן או ביצירת תוכן, זה יופיע כאן." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Card className="p-4 text-center">
              <div className="text-2xl font-extrabold">${totalCost.toFixed(3)}</div>
              <div className="text-xs text-muted-foreground">עלות היום</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-extrabold">{runs.length}</div>
              <div className="text-xs text-muted-foreground">קריאות</div>
            </Card>
            <Card className="p-4 text-center">
              <div className={`text-2xl font-extrabold ${errorRate > 0.1 ? "text-destructive" : ""}`}>
                {(errorRate * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-muted-foreground">שיעור שגיאות</div>
            </Card>
          </div>

          <Card className="mb-4 p-4">
            <h2 className="mb-3 font-bold">פילוח לפי סוג קריאה</h2>
            <div className="flex flex-col gap-2">
              {[...byKind.entries()].map(([kind, stat]) => (
                <div key={kind} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{KIND_LABEL[kind] ?? kind}</span>
                  <span className="text-muted-foreground">
                    {stat.count} קריאות · ${stat.cost.toFixed(3)}
                    {stat.errors > 0 && <span className="text-destructive"> · {stat.errors} שגיאות</span>}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-bold">קריאות אחרונות</h2>
            <div className="flex flex-col gap-2">
              {runs.slice(0, 20).map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{KIND_LABEL[r.kind] ?? r.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {r.latency_ms}ms · ${Number(r.cost_usd).toFixed(4)}
                    </div>
                  </div>
                  <Badge tone={r.status === "error" ? "muted" : "primary"} className={r.status === "error" ? "text-destructive" : ""}>
                    {r.status === "error" ? "שגיאה" : "תקין"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
