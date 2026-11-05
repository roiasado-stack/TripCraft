import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Crown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Trip, TripMember } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/permissions";
import { planAddTraveller } from "@/lib/join-requests";
import { dateRangeHeb } from "@/lib/trip-dates";
import { Badge, Button, EmptyState, GroupedList, Spinner } from "@/components/ui";

type RequestRow = TripMember & { trips: Pick<Trip, "id" | "title" | "start_date" | "end_date"> };
type RowAction = "approve" | "approve_add" | "reject";

/**
 * Every pending join request across the agent's trips (/agency/requests, inside
 * AgencyLayout). Every row is on a trip this user owns (the query below), so the
 * caller's role is "owner" on all of them and the actions need no further gate;
 * RLS "owner manages" stays the authority.
 */
export default function AgencyRequestsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<Record<string, RowAction>>({});
  // Synchronous, unlike state: a second tap in the same tick can't get through.
  const inFlight = useRef(new Set<string>());
  // A reload that started earlier must not overwrite a newer one.
  const latestLoad = useRef(0);
  const today = useMemo(() => new Date(), []);

  const load = async () => {
    if (!user) return;
    const seq = ++latestLoad.current;
    // RLS "members list" also returns this user's own pending row on someone
    // else's trip. user_id means ownership here, not visibility.
    const { data, error } = await supabase
      .from("trip_members")
      .select("*, trips!inner(id, title, start_date, end_date)")
      .eq("status", "pending")
      .eq("trips.user_id", user.id)
      .order("created_at");
    if (seq !== latestLoad.current) return;
    if (error) {
      console.error(error);
      toast.error("לא הצלחנו לטעון את הבקשות. נסו שוב.");
      setState((s) => (s === "ready" ? s : "error"));
      return;
    }
    setRows((data as RequestRow[] | null) ?? []);
    setState("ready");
  };

  useEffect(() => {
    load();
    // Requests arrive while the app is in the background.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * The owner's write from TripMembers and AgentSendPanel.approveLead, only
   * while the row is still pending: a stale screen must not bring back someone
   * the lead or another tab has already removed. Returns false if nothing changed.
   */
  const setStatus = async (m: RequestRow, status: "active" | "removed") => {
    const { data, error } = await supabase
      .from("trip_members")
      .update({ status })
      .eq("id", m.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return !!data;
  };

  /** After the approval. Reports exactly what happened: the approval already stands. */
  const addTraveller = async (m: RequestRow) => {
    const failed = "ההצטרפות אושרה, אבל ההוספה לנוסעים נכשלה. אפשר להוסיף ידנית בטיול.";
    const { data, error: readError } = await supabase.from("participants").select("name").eq("trip_id", m.trip_id);
    if (readError) {
      console.error(readError);
      toast.error(failed);
      return;
    }
    const plan = planAddTraveller(m.display_name, ((data as { name: string }[] | null) ?? []).map((p) => p.name));
    if (plan.kind === "no_name") {
      toast.toast("ההצטרפות אושרה, אבל הנוסע לא נוסף כי אין לו שם. אפשר להוסיף ידנית בטיול.");
      return;
    }
    if (plan.kind === "exists") {
      toast.success("ההצטרפות אושרה. השם כבר ברשימת הנוסעים, אז לא נוספה שורה.");
      return;
    }
    const { error } = await supabase.from("participants").insert({ trip_id: m.trip_id, name: plan.name });
    if (error) {
      console.error(error);
      toast.error(failed);
      return;
    }
    toast.success("ההצטרפות אושרה והנוסע נוסף לטיול");
  };

  const act = async (m: RequestRow, action: RowAction) => {
    if (inFlight.current.has(m.id)) return;
    inFlight.current.add(m.id);
    setBusy((b) => ({ ...b, [m.id]: action }));
    try {
      if (!(await setStatus(m, action === "reject" ? "removed" : "active"))) {
        toast.toast("הבקשה הזו כבר טופלה");
      } else if (action === "reject") {
        toast.success("הבקשה נדחתה");
      } else if (action === "approve") {
        toast.success("ההצטרפות אושרה");
      } else {
        await addTraveller(m);
      }
    } catch (error) {
      console.error(error);
      toast.error(action === "reject" ? "הדחייה נכשלה. נסו שוב." : "האישור נכשל. נסו שוב.");
    }
    await load();
    inFlight.current.delete(m.id);
    setBusy(({ [m.id]: _done, ...rest }) => rest);
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-5 lg:max-w-4xl lg:px-8 lg:pt-8">
      <Link to="/agency" className="type-body -ms-1 mb-2 inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronRight className="size-5" aria-hidden />
        הטיולים
      </Link>
      <div className="mb-5 px-1">
        <h1 className="type-large-title">בקשות הצטרפות</h1>
        {state === "ready" && rows.length > 0 && (
          <p className="type-footnote text-muted-foreground">{rows.length === 1 ? "בקשה אחת ממתינה" : `${rows.length} בקשות ממתינות`}</p>
        )}
      </div>

      {state === "loading" ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : state === "error" ? (
        <EmptyState
          emoji="⚠️"
          title="הבקשות לא נטענו"
          action={
            <Button variant="soft" onClick={load}>
              לנסות שוב
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="✅" title="אין בקשות ממתינות" description="כשמישהו יבקש להצטרף לאחד הטיולים שלכם, הבקשה תופיע כאן." />
      ) : (
        <GroupedList>
          {rows.map((m) => {
            const dates = dateRangeHeb(m.trips.start_date, m.trips.end_date, today);
            const asked = new Date(m.created_at).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
            const rowBusy = busy[m.id];
            return (
              <div key={m.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="type-headline min-w-0 truncate [unicode-bidi:plaintext]">{m.display_name?.trim() || "משתמש"}</div>
                    {m.is_lead && (
                      <Badge className="shrink-0 gap-1 py-0.5">
                        <Crown className="size-3.5" aria-hidden />
                        לקוח ראשי
                      </Badge>
                    )}
                  </div>
                  <Link
                    to={`/agency/trips/${m.trips.id}`}
                    className="type-body block truncate text-primary [unicode-bidi:plaintext]"
                  >
                    {m.trips.title}
                  </Link>
                  <div className="type-footnote text-muted-foreground">
                    {[`תפקיד: ${ROLE_LABELS[m.role]}`, dates, `בקשה מ-${asked}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {/* Phone: approve and reject side by side, the long label under them. */}
                <div className="grid grid-flow-dense grid-cols-2 gap-2 lg:flex lg:shrink-0">
                  <Button loading={rowBusy === "approve"} disabled={!!rowBusy} onClick={() => act(m, "approve")}>
                    אישור
                  </Button>
                  <Button
                    variant="soft"
                    className="col-span-2"
                    loading={rowBusy === "approve_add"}
                    disabled={!!rowBusy}
                    onClick={() => act(m, "approve_add")}
                  >
                    אישור והוספה לנוסעים
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    loading={rowBusy === "reject"}
                    disabled={!!rowBusy}
                    onClick={() => act(m, "reject")}
                  >
                    דחייה
                  </Button>
                </div>
              </div>
            );
          })}
        </GroupedList>
      )}
    </div>
  );
}
