import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileUp, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { AgentTripBoardRow } from "@/lib/types";
import { Badge, Button, EmptyState, GroupedList, Segmented, Spinner } from "@/components/ui";
import { Flag } from "@/components/Flag";
import {
  AGENT_STATUS_LABEL,
  agentTripStatus,
  attentionNotes,
  boardCounters,
  matchesBoardQuery,
  needsHandling,
  sortBoard,
  tripsCountHe,
  type AgentTripStatus,
} from "@/lib/agent-board";
import { dateRangeHeb } from "@/lib/trip-dates";

const STATUS_TONE: Record<AgentTripStatus, "primary" | "accent" | "sun" | "muted"> = {
  draft: "muted",
  sent: "primary",
  soon: "primary",
  abroad: "sun",
  back: "muted",
  attention: "accent",
};

type Filter = "all" | "attention";

/**
 * The agent's workspace (agency beta, phase 2). First thing: a new trip from
 * the documents the agent already has. Below it, every trip they own as one
 * list from agent_trip_board(), with a status, search and "needs handling".
 */
export default function AgentPage() {
  const { profile, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgentTripBoardRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [requestedAgency, setRequestedAgency] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    const [{ data, error }, { data: account }] = await Promise.all([
      supabase.rpc("agent_trip_board"),
      // By user_id: an admin can read every agent's row.
      user
        ? supabase.from("agent_accounts").select("agency_name").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setRequestedAgency((account as { agency_name: string } | null)?.agency_name ?? null);
    if (error) {
      console.error(error);
      toast.error("לא הצלחנו לטעון את הטיולים. נסו שוב.");
      setState("error");
      return;
    }
    setRows((data as AgentTripBoardRow[] | null) ?? []);
    setState("ready");
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = useMemo(() => new Date(), []);
  const attentionCount = rows.filter(needsHandling).length;
  const visible = sortBoard(rows, today).filter((r) => (filter === "all" || needsHandling(r)) && matchesBoardQuery(r, query));
  // The branding name from settings, else the name the agent asked for access with.
  const agency = profile?.agency_name?.trim() || requestedAgency?.trim();

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-4">
      <header className="mb-1">
        <Link
          to="/"
          className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="חזרה לטיולים"
        >
          <ChevronRight className="size-6" />
        </Link>
      </header>

      <div className="mb-5 px-1">
        {agency && <p className="type-footnote truncate font-semibold text-muted-foreground">{agency}</p>}
        <h1 className="type-large-title">סביבת הסוכן</h1>
      </div>

      <section className="mb-8">
        <Button size="lg" className="pressable w-full" onClick={() => navigate("/agent/new")}>
          <FileUp className="size-5" />
          טיול חדש מהמסמכים
        </Button>
        <p className="type-footnote mt-2 px-4 text-center text-muted-foreground">
          מעלים כרטיסי טיסה, אישור מלון או רכב (עד 8 קבצים), בודקים ושולחים ללקוח.
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-end justify-between gap-2 px-1">
          <h2 className="type-title">הטיולים שלי</h2>
          {state === "ready" && rows.length > 0 && (
            <span className="type-footnote shrink-0 text-muted-foreground">{tripsCountHe(rows.length)}</span>
          )}
        </div>

        {state === "loading" ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : state === "error" ? (
          <EmptyState
            emoji="⚠️"
            title="הרשימה לא נטענה"
            action={
              <Button variant="soft" onClick={load}>
                לנסות שוב
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="🧳"
            title="עוד אין טיולים"
            description="הטיול הראשון מתחיל מהמסמכים שכבר יש לכם: כרטיסי טיסה ואישור מלון."
          />
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח או יעד"
                aria-label="חיפוש לפי לקוח או יעד"
                className="type-body h-11 w-full rounded-2xl bg-card ps-11 pe-4 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <Segmented
              className="mb-4"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "הכל" },
                { value: "attention", label: attentionCount ? `דורשים טיפול (${attentionCount})` : "דורשים טיפול" },
              ]}
            />

            {visible.length === 0 ? (
              <p className="type-footnote rounded-2xl bg-card px-4 py-6 text-center text-muted-foreground">
                {filter === "attention" && !query.trim() ? "אין טיולים שדורשים טיפול כרגע ✓" : "לא נמצאו טיולים"}
              </p>
            ) : (
              <GroupedList>
                {visible.map((r) => (
                  <BoardRow key={r.id} row={r} today={today} />
                ))}
              </GroupedList>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function BoardRow({ row, today }: { row: AgentTripBoardRow; today: Date }) {
  const status = agentTripStatus(row, today);
  // A draft hasn't been sent, so "nobody joined" says nothing new there.
  const notes = attentionNotes(
    status === "draft" ? { ...row, needs_attention: row.needs_attention.filter((f) => f !== "not_joined") } : row,
  );
  const client = row.client_name?.trim();
  const meta = [row.destination, dateRangeHeb(row.start_date, row.end_date, today)].filter(Boolean).join(" · ");
  return (
    <Link to={`/trip/${row.id}`} className="flex items-center gap-3 py-3 ps-4 pe-2 transition-colors active:bg-muted/70">
      <Flag destination={row.destination} fallback="✈️" className="w-[36px] text-[26px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="type-headline min-w-0 flex-1 truncate [unicode-bidi:plaintext]">{client || row.title}</div>
          <Badge tone={STATUS_TONE[status]} className="shrink-0 py-0.5">
            {AGENT_STATUS_LABEL[status]}
          </Badge>
        </div>
        <div className="type-footnote truncate text-muted-foreground">{meta}</div>
        <div className="type-footnote truncate text-muted-foreground">{boardCounters(row)}</div>
        {notes.length > 0 && <div className="type-footnote truncate font-semibold text-accent">{notes.join(" · ")}</div>}
      </div>
      <ChevronLeft className="size-5 shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}
