import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, FileUp, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
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
 * The trip board, the home of the agency workspace (/agency, inside
 * AgencyLayout). Every trip the agent owns from agent_trip_board(), with a
 * status, search and "needs handling": a table on a wide screen, a list on a
 * phone. The first action is a new trip from the documents the agent has.
 */
export default function AgentPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgentTripBoardRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = async () => {
    setState("loading");
    const { data, error } = await supabase.rpc("agent_trip_board");
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

  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-5 lg:max-w-6xl lg:px-8 lg:pt-8">
      <div className="mb-5 flex flex-col gap-4 lg:mb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="px-1">
          <h1 className="type-large-title">הטיולים</h1>
          {state === "ready" && rows.length > 0 && (
            <p className="type-footnote text-muted-foreground">{tripsCountHe(rows.length)}</p>
          )}
        </div>
        <div>
          <Button size="lg" className="pressable w-full lg:w-auto" onClick={() => navigate("/agency/new")}>
            <FileUp className="size-5" />
            טיול חדש מהמסמכים
          </Button>
          <p className="type-footnote mt-2 px-4 text-center text-muted-foreground lg:hidden">
            מעלים כרטיסי טיסה, אישור מלון או רכב (עד 8 קבצים), בודקים ושולחים ללקוח.
          </p>
        </div>
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
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative lg:w-80">
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
              className="lg:w-80"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "הכל" },
                { value: "attention", label: attentionCount ? `דורשים טיפול (${attentionCount})` : "דורשים טיפול" },
              ]}
            />
          </div>

          {visible.length === 0 ? (
            <p className="type-footnote rounded-2xl bg-card px-4 py-6 text-center text-muted-foreground">
              {filter === "attention" && !query.trim() ? "אין טיולים שדורשים טיפול כרגע ✓" : "לא נמצאו טיולים"}
            </p>
          ) : (
            <>
              <div className="lg:hidden">
                <GroupedList>
                  {visible.map((r) => (
                    <BoardRow key={r.id} row={r} today={today} />
                  ))}
                </GroupedList>
              </div>
              <BoardTable rows={visible} today={today} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** What the board shows for one trip, shared by the phone row and the table row. */
function rowView(row: AgentTripBoardRow, today: Date) {
  const status = agentTripStatus(row, today);
  // A draft hasn't been sent, so "nobody joined" says nothing new there.
  const notes = attentionNotes(
    status === "draft" ? { ...row, needs_attention: row.needs_attention.filter((f) => f !== "not_joined") } : row,
  );
  return {
    status,
    notes,
    name: row.client_name?.trim() || row.title,
    dates: dateRangeHeb(row.start_date, row.end_date, today),
    counters: boardCounters(row),
  };
}

function BoardRow({ row, today }: { row: AgentTripBoardRow; today: Date }) {
  const v = rowView(row, today);
  const meta = [row.destination, v.dates].filter(Boolean).join(" · ");
  return (
    <Link to={`/agency/trips/${row.id}`} className="flex items-center gap-3 py-3 ps-4 pe-2 transition-colors active:bg-muted/70">
      <Flag destination={row.destination} fallback="✈️" className="w-[36px] text-[26px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="type-headline min-w-0 flex-1 truncate [unicode-bidi:plaintext]">{v.name}</div>
          <Badge tone={STATUS_TONE[v.status]} className="shrink-0 py-0.5">
            {AGENT_STATUS_LABEL[v.status]}
          </Badge>
        </div>
        <div className="type-footnote truncate text-muted-foreground">{meta}</div>
        <div className="type-footnote truncate text-muted-foreground">{v.counters}</div>
        {v.notes.length > 0 && <div className="type-footnote truncate font-semibold text-accent">{v.notes.join(" · ")}</div>}
      </div>
      <ChevronLeft className="size-5 shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}

/** The wide-screen board: one row per trip, the whole row opens it. */
function BoardTable({ rows, today }: { rows: AgentTripBoardRow[]; today: Date }) {
  const navigate = useNavigate();
  const th = "type-footnote px-4 py-3 text-start font-semibold text-muted-foreground";
  const td = "px-4 py-3 align-middle";
  return (
    <div className="hidden overflow-hidden rounded-2xl bg-card text-card-foreground lg:block">
      <table className="w-full table-fixed border-collapse">
        <thead className="border-b border-separator">
          <tr>
            <th className={`${th} w-[28%]`}>לקוח</th>
            <th className={`${th} w-[18%]`}>יעד</th>
            <th className={`${th} w-[16%]`}>תאריכים</th>
            <th className={`${th} w-[12%]`}>סטטוס</th>
            <th className={th}>מצב הטיול</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-separator">
          {rows.map((row) => {
            const v = rowView(row, today);
            const open = () => navigate(`/agency/trips/${row.id}`);
            return (
              <tr
                key={row.id}
                onClick={open}
                className="cursor-pointer transition-colors hover:bg-muted/60"
              >
                <td className={td}>
                  {/* The link keeps keyboard, middle-click and "open in a new tab" working. */}
                  <Link
                    to={`/agency/trips/${row.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex min-w-0 items-center gap-3 outline-none focus-visible:underline"
                  >
                    <Flag destination={row.destination} fallback="✈️" className="w-[28px] shrink-0 text-[22px]" />
                    <span className="min-w-0">
                      <span className="type-headline block truncate [unicode-bidi:plaintext]">{v.name}</span>
                      {row.client_name?.trim() && (
                        <span className="type-footnote block truncate text-muted-foreground [unicode-bidi:plaintext]">
                          {row.title}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className={`${td} type-body truncate [unicode-bidi:plaintext]`}>{row.destination || "—"}</td>
                <td className={`${td} type-body truncate`}>{v.dates || "—"}</td>
                <td className={td}>
                  <Badge tone={STATUS_TONE[v.status]} className="py-0.5">
                    {AGENT_STATUS_LABEL[v.status]}
                  </Badge>
                </td>
                <td className={`${td} min-w-0`}>
                  <div className="type-footnote truncate text-muted-foreground">{v.counters}</div>
                  {v.notes.length > 0 && (
                    <div className="type-footnote truncate font-semibold text-accent">{v.notes.join(" · ")}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
