import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, ChevronRight, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { AgentAccountUsage } from "@/lib/types";
import { Button, EmptyState, Field, GroupedList, Input, Modal, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  AGENT_LIMIT_BOUNDS,
  AGENT_MIN_PHOTOS_PER_DAY,
  adminAgentErrorHe,
  agentPhotoLimit,
  agentsCountHe,
  formatUsd,
  groupAgents,
  limitsDraft,
  requestsCountHe,
  usageLevel,
  usagePercent,
  usdOfLimit,
  validateAgentLimits,
  type AgentLimitDraft,
  type AgentLimitField,
} from "@/lib/agent-admin";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

/** One labelled usage bar: "AI היום · ‎$1.20 מתוך ‎$3". */
function UsageBar({ label, used, limit, text }: { label: string; used: number; limit: number; text: string }) {
  const level = usageLevel(used, limit);
  return (
    <div>
      <div className="type-footnote mb-1 flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", level === "full" ? "text-destructive" : "text-foreground")}>{text}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usagePercent(used, limit)}
      >
        <div
          className={cn("h-full rounded-full", level === "full" ? "bg-destructive" : level === "high" ? "bg-sun" : "bg-primary")}
          style={{ width: `${usagePercent(used, limit)}%` }}
        />
      </div>
    </div>
  );
}

/** Agency name + email (truncated) + phone — the identity block of every row. */
function AgentIdentity({ a, note }: { a: AgentAccountUsage; note?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="type-headline truncate [unicode-bidi:plaintext]">{a.agency_name}</div>
      {a.email && (
        // LTR so the address reads correctly; text-end of an LTR box is the RTL row's start edge.
        <div className="type-footnote truncate text-end text-muted-foreground" dir="ltr">
          {a.email}
        </div>
      )}
      <div className="type-footnote truncate text-muted-foreground">
        {a.phone && (
          <a href={`tel:${a.phone}`} className="text-primary" dir="ltr">
            {a.phone}
          </a>
        )}
        {a.phone && note && " · "}
        {note}
      </div>
    </div>
  );
}

const LIMIT_FIELDS: { field: AgentLimitField; label: string; hint: string; inputMode: "decimal" | "numeric" }[] = [
  {
    field: "ai_daily_usd",
    label: "AI ליום ($)",
    hint: `בין 0 ל-${AGENT_LIMIT_BOUNDS.ai_daily_usd.max} (מתחת לתקרה היומית של כל האפליקציה)`,
    inputMode: "decimal",
  },
  { field: "ai_monthly_usd", label: "AI לחודש ($)", hint: `בין 0 ל-${AGENT_LIMIT_BOUNDS.ai_monthly_usd.max}`, inputMode: "decimal" },
  {
    field: "google_daily",
    label: "קריאות Google ליום",
    hint: `בין 0 ל-${AGENT_LIMIT_BOUNDS.google_daily.max}. חיפושים: המספר הזה ליום. תמונות: לפחות ${AGENT_MIN_PHOTOS_PER_DAY} ליום, או המספר הזה אם הוא גבוה יותר`,
    inputMode: "numeric",
  },
  { field: "max_active_trips", label: "טיולים פעילים", hint: `בין 0 ל-${AGENT_LIMIT_BOUNDS.max_active_trips.max}`, inputMode: "numeric" },
];

/**
 * Admin-only "סוכנים" screen (agency beta, phase 4): pending requests to
 * approve or reject, active agents with today's / this month's usage against
 * their limits, suspended accounts to re-approve. Everything goes through the
 * admin RPCs of migration 022, which check the admin role themselves.
 */
export default function AdminAgentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AgentAccountUsage[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentAccountUsage | null>(null);
  const [draft, setDraft] = useState<AgentLimitDraft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<AgentLimitField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState<AgentAccountUsage | null>(null);

  const load = async (quiet = false) => {
    if (!quiet) setState("loading");
    const { data, error } = await supabase.rpc("admin_list_agents");
    if (error) {
      console.error(error);
      toast.error("לא הצלחנו לטעון את רשימת הסוכנים. נסו שוב.");
      setState("error");
      return;
    }
    setRows((data as AgentAccountUsage[] | null) ?? []);
    setState("ready");
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (a: AgentAccountUsage, approve: boolean, successMsg: string) => {
    setBusy(a.user_id);
    const { error } = await supabase.rpc("admin_decide_agent", { p_user_id: a.user_id, p_approve: approve });
    setBusy(null);
    if (error) {
      console.error(error);
      toast.error(adminAgentErrorHe(error));
      return false;
    }
    toast.success(successMsg);
    await load(true);
    return true;
  };

  const openLimits = (a: AgentAccountUsage) => {
    setEditing(a);
    setDraft(limitsDraft(a));
    setErrors({});
  };

  const saveLimits = async () => {
    if (!editing || !draft) return;
    const result = validateAgentLimits(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    const v = result.values;
    const { error } = await supabase.rpc("admin_set_agent_limits", {
      p_user_id: editing.user_id,
      p_ai_daily_usd: v.ai_daily_usd,
      p_ai_monthly_usd: v.ai_monthly_usd,
      p_google_daily: v.google_daily,
      p_max_active_trips: v.max_active_trips,
    });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(adminAgentErrorHe(error));
      return;
    }
    toast.success(`המכסות של ${editing.agency_name} נשמרו`);
    setEditing(null);
    await load(true);
  };

  const { pending, active, suspended } = groupAgents(rows);

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-4">
      <header className="mb-1">
        <Link
          to="/settings"
          className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="חזרה להגדרות"
        >
          <ChevronRight className="size-6" />
        </Link>
      </header>

      <div className="mb-6 px-1">
        <p className="type-footnote font-semibold text-muted-foreground">ניהול</p>
        <h1 className="type-large-title">סוכנים</h1>
        <p className="type-footnote mt-2 text-muted-foreground">
          אישור פותח לסוכן את סביבת הסוכן אחרי שירענן את האפליקציה. שינוי מכסה נאכף בקריאת ה-AI הבאה שלו.
        </p>
      </div>

      {state === "loading" ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : state === "error" ? (
        <EmptyState
          emoji="⚠️"
          title="הרשימה לא נטענה"
          action={
            <Button variant="soft" onClick={() => load()}>
              לנסות שוב
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🧳"
          title="עוד אין בקשות"
          description="סוכן מבקש גישה בהגדרות, בלחיצה על “אני סוכן/ת נסיעות”. הבקשה תופיע כאן."
        />
      ) : (
        <div className="flex flex-col gap-7">
          {pending.length > 0 && (
            <GroupedList
              title="בקשות ממתינות"
              action={<span className="type-footnote text-muted-foreground">{requestsCountHe(pending.length)}</span>}
            >
              {pending.map((a) => (
                <div key={a.user_id} className="px-4 py-3">
                  <AgentIdentity a={a} note={`ביקש/ה ב-${shortDate(a.requested_at)}`} />
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="pressable flex-1"
                      loading={busy === a.user_id}
                      disabled={busy !== null}
                      onClick={() => decide(a, true, `${a.agency_name} אושר/ה כסוכן/ת`)}
                    >
                      <Check className="size-4" />
                      אישור
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="pressable flex-1"
                      disabled={busy !== null}
                      onClick={() => decide(a, false, `הבקשה של ${a.agency_name} נדחתה`)}
                    >
                      <X className="size-4" />
                      דחייה
                    </Button>
                  </div>
                </div>
              ))}
            </GroupedList>
          )}

          <GroupedList
            title="סוכנים פעילים"
            action={active.length > 0 && <span className="type-footnote text-muted-foreground">{agentsCountHe(active.length)}</span>}
          >
            {active.length === 0 ? (
              <p className="type-footnote px-4 py-4 text-muted-foreground">אין כרגע סוכנים פעילים.</p>
            ) : (
              active.map((a) => (
                <div key={a.user_id} className="px-4 py-3">
                  <AgentIdentity a={a} note={a.decided_at ? `אושר/ה ב-${shortDate(a.decided_at)}` : undefined} />
                  <div className="mt-3 flex flex-col gap-2.5">
                    <UsageBar label="AI היום" used={a.ai_today_usd} limit={a.ai_daily_usd} text={usdOfLimit(a.ai_today_usd, a.ai_daily_usd)} />
                    <UsageBar
                      label="AI החודש"
                      used={a.ai_month_usd}
                      limit={a.ai_monthly_usd}
                      text={usdOfLimit(a.ai_month_usd, a.ai_monthly_usd)}
                    />
                    <UsageBar
                      label="חיפושי Google היום"
                      used={a.google_searches_today}
                      limit={a.google_daily}
                      text={`${a.google_searches_today} מתוך ${a.google_daily}`}
                    />
                    <UsageBar
                      label="תמונות Google היום"
                      used={a.google_photos_today}
                      limit={agentPhotoLimit(a.google_daily)}
                      text={`${a.google_photos_today} מתוך ${agentPhotoLimit(a.google_daily)}`}
                    />
                    <UsageBar
                      label="טיולים פעילים"
                      used={a.active_trips}
                      limit={a.max_active_trips}
                      text={`${a.active_trips} מתוך ${a.max_active_trips}`}
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="soft" className="pressable flex-1" disabled={busy !== null} onClick={() => openLimits(a)}>
                      <SlidersHorizontal className="size-4" />
                      מכסות
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="pressable flex-1 text-destructive"
                      disabled={busy !== null}
                      onClick={() => setSuspending(a)}
                    >
                      <Ban className="size-4" />
                      השעיה
                    </Button>
                  </div>
                </div>
              ))
            )}
          </GroupedList>

          {suspended.length > 0 && (
            <GroupedList
              title="מושעים"
              action={<span className="type-footnote text-muted-foreground">{agentsCountHe(suspended.length)}</span>}
            >
              {suspended.map((a) => (
                <div key={a.user_id} className="flex items-center gap-3 px-4 py-3">
                  <AgentIdentity a={a} note={a.decided_at ? `מאז ${shortDate(a.decided_at)}` : undefined} />
                  <Button
                    size="sm"
                    variant="soft"
                    className="pressable shrink-0"
                    loading={busy === a.user_id}
                    disabled={busy !== null}
                    onClick={() => decide(a, true, `${a.agency_name} אושר/ה מחדש`)}
                  >
                    <RotateCcw className="size-4" />
                    אישור מחדש
                  </Button>
                </div>
              ))}
            </GroupedList>
          )}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => !saving && setEditing(null)}
        title={editing ? `מכסות · ${editing.agency_name}` : "מכסות"}
        footer={
          <>
            <Button className="flex-1" loading={saving} onClick={saveLimits}>
              שמירה
            </Button>
            <Button variant="outline" className="flex-1" disabled={saving} onClick={() => setEditing(null)}>
              ביטול
            </Button>
          </>
        }
      >
        {draft && (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              saveLimits();
            }}
          >
            {LIMIT_FIELDS.map(({ field, label, hint, inputMode }) => (
              <div key={field}>
                <Field label={label} hint={errors[field] ? undefined : hint}>
                  <Input
                    dir="ltr"
                    inputMode={inputMode}
                    value={draft[field]}
                    aria-invalid={errors[field] ? true : undefined}
                    className={cn("text-end tabular-nums", errors[field] && "border-destructive")}
                    onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                  />
                </Field>
                {errors[field] && <p className="mt-1 text-xs font-semibold text-destructive">{errors[field]}</p>}
              </div>
            ))}
            {editing && (
              <p className="type-footnote text-muted-foreground">
                היום: {formatUsd(editing.ai_today_usd)} · החודש: {formatUsd(editing.ai_month_usd)} · {editing.active_trips} טיולים פעילים
              </p>
            )}
            <button type="submit" hidden />
          </form>
        )}
      </Modal>

      <Modal
        open={suspending !== null}
        onClose={() => busy === null && setSuspending(null)}
        title={suspending ? `להשעות את ${suspending.agency_name}?` : "השעיה"}
        footer={
          <>
            <Button
              variant="destructive"
              className="flex-1"
              loading={suspending !== null && busy === suspending.user_id}
              onClick={async () => {
                if (!suspending) return;
                const ok = await decide(suspending, false, `${suspending.agency_name} הושעה/תה`);
                if (ok) setSuspending(null);
              }}
            >
              השעיה
            </Button>
            <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => setSuspending(null)}>
              ביטול
            </Button>
          </>
        }
      >
        <p className="type-body text-muted-foreground">
          הגישה לסביבת הסוכן תיחסם אחרי רענון, וקריאות ה-AI יחזרו למכסה של משתמש רגיל. הטיולים נשארים אצל הסוכן, ואפשר
          לאשר מחדש בכל רגע.
        </p>
      </Modal>
    </div>
  );
}
