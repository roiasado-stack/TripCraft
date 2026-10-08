import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUp, CalendarPlus, Heart, MoreHorizontal, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AgentCard, PendingAction, TripChatMessage } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader } from "@/components/TripHeader";
import { Button, EmptyState, GroupedList, Modal, SheetRow, Spinner, Textarea } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { aiErrorMessage, askAgent, confirmAgentAction, type AskTurn } from "@/lib/ai";
import { MapLink } from "@/components/MapLink";
import { formatDayHeb, suggestionKindLabel } from "@/lib/trip-options";
import { resolveMapUrl } from "@/lib/maps";
import { cn } from "@/lib/utils";
import { localDateString, parseLocalDate } from "@/lib/trip-dates";

const STARTERS = [
  "מה עושים ביום גשום?",
  "איפה אוכלים בסביבת המלון?",
  "מה כדאי להזמין מראש?",
  "מה מתאים לילדים הקטנים?",
];

export default function AskTab() {
  const { trip, role } = useTrip();
  const canEdit = can(role, "edit");
  const toast = useToast();
  const [messages, setMessages] = useState<TripChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<Record<string, "confirmed" | "dismissed">>({});
  /** Last failure, kept in the thread — the toast is gone in 3.6s but the
      unanswered question stays, so it needs a durable explanation. */
  const [failed, setFailed] = useState<{ question: string; message: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  /** State guard, not `thinking`: two fast Enters read the same stale closure
      and each send costs money. */
  const inFlight = useRef(false);

  const load = async () => {
    const { data } = await supabase
      .from("trip_chat_messages")
      .select("*")
      .eq("trip_id", trip.id)
      .order("created_at");
    setMessages((data as TripChatMessage[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || inFlight.current) return;
    inFlight.current = true;
    setDraft("");
    setFailed(null);
    setThinking(true);

    // Replay the conversation so far, then persist both turns ourselves —
    // the edge function is stateless and writes nothing.
    const history: AskTurn[] = messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const { data: userRow } = await supabase
      .from("trip_chat_messages")
      .insert({ trip_id: trip.id, role: "user", content: question })
      .select()
      .single();
    if (userRow) setMessages((m) => [...m, userRow as TripChatMessage]);

    const res = await askAgent(trip, question, history);
    setThinking(false);
    inFlight.current = false;

    if (!res.ok) {
      const message = aiErrorMessage(res.error, "הסוכן לא הצליח לענות. נסו שוב.");
      setFailed({ question, message });
      toast.error(message);
      return;
    }

    const { data: botRow } = await supabase
      .from("trip_chat_messages")
      .insert({
        trip_id: trip.id,
        role: "assistant",
        content: res.answer,
        cards: res.cards ?? [],
        pending_actions: res.pendingActions ?? [],
      })
      .select()
      .single();
    if (botRow) setMessages((m) => [...m, botRow as TripChatMessage]);
  };

  const confirmPending = async (action: PendingAction, key: string) => {
    const res = await confirmAgentAction(trip, action);
    if (!res.ok) {
      toast.error("האישור נכשל. נסה שוב.");
      return;
    }
    setResolved((r) => ({ ...r, [key]: "confirmed" }));
    toast.success(action.tool === "add_to_itinerary" ? "נוסף למסלול 🗓️" : "נוסף למומלצים ✨");
  };

  const addToSuggestions = async (card: AgentCard, key: string) => {
    // `added` is per-render state, so after a refresh the button is live again.
    // Match the dedupe-by-title behaviour of the curated picks in SuggestionsTab.
    const { data: dupe } = await supabase
      .from("suggestions")
      .select("id")
      .eq("trip_id", trip.id)
      .eq("title", card.title)
      .maybeSingle();
    if (dupe) {
      setAdded((a) => ({ ...a, [key]: true }));
      toast.toast("ההמלצה כבר קיימת ברשימה");
      return;
    }

    const { error } = await supabase.from("suggestions").insert({
      trip_id: trip.id,
      kind: card.kind,
      title: card.title,
      description: card.description,
      tags: card.tags,
      price_level: card.price_level,
      location: card.location,
      map_url: resolveMapUrl(null, card.location ?? card.title, trip.destination),
    });
    if (error) {
      toast.error("ההוספה נכשלה. נסה שוב.");
      return;
    }
    setAdded((a) => ({ ...a, [key]: true }));
    toast.success("נוסף למומלצים ✨");
  };

  const addToItinerary = async (card: AgentCard, key: string) => {
    const day = trip.start_date ?? localDateString(new Date());
    const { error } = await supabase.from("itinerary_items").insert({
      trip_id: trip.id,
      day_date: day,
      title: card.title,
      description: card.description,
      category: card.kind === "restaurant" ? "food" : "activity",
      location: card.location,
    });
    if (error) {
      toast.error("ההוספה למסלול נכשלה. נסה שוב.");
      return;
    }
    setAdded((a) => ({ ...a, [key]: true }));
    toast.success("נוסף למסלול 🗓️");
  };

  const clearChat = async () => {
    const { error } = await supabase.from("trip_chat_messages").delete().eq("trip_id", trip.id);
    if (error) {
      toast.error("מחיקת השיחה נכשלה");
      return;
    }
    setMessages([]);
    setAdded({});
    toast.success("השיחה נמחקה");
  };

  // Viewers can read the trip but not use the agent (the ask function refuses
  // them too), so explain instead of showing a composer that would fail.
  if (!can(role, "participate")) {
    return (
      <div className="px-4">
        <TripHeader trip={trip} subtitle="שאלות והמלצות" />
        <EmptyState
          emoji="💬"
          title="הסוכן זמין למשתתפים בטיול"
          description="יש לך הרשאת צפייה. בעל הטיול יכול לשנות אותך למשתתף כדי שתוכל לשאול את הסוכן."
        />
      </div>
    );
  }

  return (
    // Fills the viewport minus TripLayout's pb-24, so the composer is pushed to
    // the bottom by the growing message area. `sticky` alone only pins once the
    // page overflows — on a short conversation it just floated mid-screen.
    <div className="flex min-h-[calc(100svh-6rem)] flex-col px-4">
      <TripHeader trip={trip} subtitle="שאלות והמלצות" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">שאל את הסוכן</h2>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="אפשרויות לשיחה"
            className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
          >
            <MoreHorizontal className="size-5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 pb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center pt-2 text-center">
              <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Sparkles className="size-7" />
              </div>
              <h3 className="type-headline [overflow-wrap:anywhere]">
                מה בא לך לדעת על <bdi>{trip.destination}</bdi>?
              </h3>
              <p className="type-footnote mt-1 max-w-xs text-muted-foreground">
                הסוכן מכיר את התאריכים, המשתתפים והמסלול שלך. שאל אותו כל דבר, או התחל מאחת מאלה:
              </p>
              <GroupedList className="mt-4 w-full text-start">
                {STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="type-body flex min-h-12 w-full items-center px-4 py-3 text-start text-primary transition-colors active:bg-muted/70"
                  >
                    {q}
                  </button>
                ))}
              </GroupedList>
            </div>
          )}

          {messages.map((m) => {
            const mine = m.role === "user";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[85%]", !mine && "w-full")}>
                  <div
                    // Answers are Hebrew and often open a line with a place name, so they stay
                    // RTL; the traveller's own message may be in any language.
                    dir={mine ? "auto" : undefined}
                    className={cn(
                      "type-body whitespace-pre-wrap rounded-3xl px-4 py-2.5 [overflow-wrap:anywhere]",
                      mine ? "rounded-es-lg bg-primary text-primary-foreground" : "rounded-ee-lg bg-card text-card-foreground",
                    )}
                  >
                    {richText(m.content)}
                  </div>

                  {m.cards?.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {m.cards.map((card, idx) => {
                        const key = `${m.id}:${idx}`;
                        return (
                          <div key={key} className="overflow-hidden rounded-2xl bg-card text-card-foreground">
                            <div className="flex items-start gap-2 px-4 pb-2 pt-3">
                              <div className="min-w-0 flex-1">
                                <div className="type-headline [overflow-wrap:anywhere]">
                                  <bdi>{card.title}</bdi>
                                </div>
                                <div className="type-footnote text-muted-foreground">{suggestionKindLabel(card.kind)}</div>
                              </div>
                              <MapLink url={resolveMapUrl(null, card.location ?? card.title, trip.destination)} />
                            </div>
                            {card.description && (
                              <p className="type-footnote px-4 pb-3 text-muted-foreground [overflow-wrap:anywhere]">{card.description}</p>
                            )}
                            <div className="flex divide-x divide-separator border-t border-separator rtl:divide-x-reverse">
                              <button
                                type="button"
                                disabled={added[key]}
                                onClick={() => addToSuggestions(card, key)}
                                className="type-footnote flex min-h-11 flex-1 items-center justify-center gap-1.5 font-semibold text-primary transition-colors active:bg-muted/70 disabled:text-muted-foreground"
                              >
                                <Heart className="size-4" /> {added[key] ? "נוסף" : "למומלצים"}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  disabled={added[key]}
                                  onClick={() => addToItinerary(card, key)}
                                  className="type-footnote flex min-h-11 flex-1 items-center justify-center gap-1.5 font-semibold text-primary transition-colors active:bg-muted/70 disabled:text-muted-foreground"
                                >
                                  <CalendarPlus className="size-4" /> למסלול
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {m.pending_actions?.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {m.pending_actions.map((action, idx) => {
                        const key = `${m.id}:pa:${idx}`;
                        const input = action.input;
                        const title = String(input.title ?? "");
                        const description = typeof input.description === "string" ? input.description : null;
                        const isItinerary = action.tool === "add_to_itinerary";
                        const state = resolved[key];
                        return (
                          <div key={key} className="overflow-hidden rounded-2xl bg-card text-card-foreground ring-1 ring-primary/30">
                            <div className="px-4 pb-3 pt-3">
                              <div className="type-footnote mb-1 flex items-center gap-1.5 font-semibold text-primary">
                                {isItinerary ? <CalendarPlus className="size-3.5" /> : <Heart className="size-3.5" />}
                                {isItinerary ? "הצעה להוספה למסלול" : "הצעה להוספה למומלצים"}
                              </div>
                              <div className="type-headline [overflow-wrap:anywhere]">
                                <bdi>{title}</bdi>
                              </div>
                              {description && (
                                <p className="type-footnote mt-1 text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
                              )}
                              {isItinerary && (
                                <p className="type-footnote mt-1 tabular-nums text-muted-foreground">
                                  {/* The model's date: formatted when it parses, shown as-is otherwise. */}
                                  {parseLocalDate(String(input.day_date ?? ""))
                                    ? formatDayHeb(String(input.day_date))
                                    : String(input.day_date ?? "")}
                                  {input.start_time ? ` · ${String(input.start_time)}` : ""}
                                </p>
                              )}
                            </div>
                            <div className="flex divide-x divide-separator border-t border-separator rtl:divide-x-reverse">
                              <button
                                type="button"
                                disabled={!!state}
                                onClick={() => confirmPending(action, key)}
                                className="type-footnote flex min-h-11 flex-1 items-center justify-center font-semibold text-primary transition-colors active:bg-muted/70 disabled:text-muted-foreground"
                              >
                                {state === "confirmed" ? "אושר ✓" : "אשר הוספה"}
                              </button>
                              <button
                                type="button"
                                disabled={!!state}
                                onClick={() => setResolved((r) => ({ ...r, [key]: "dismissed" }))}
                                className="type-footnote flex min-h-11 flex-1 items-center justify-center text-muted-foreground transition-colors active:bg-muted/70"
                              >
                                {state === "dismissed" ? "בוטל" : "לא עכשיו"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {thinking && (
            <div className="flex justify-end">
              <div
                role="status"
                aria-label="הסוכן חושב…"
                className="flex items-center gap-1 rounded-3xl rounded-ee-lg bg-card px-4 py-3.5"
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-2 animate-pulse rounded-full bg-muted-foreground/60"
                    style={{ animationDelay: `${i * 180}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {failed && !thinking && (
            <div className="flex justify-end">
              <div className="w-full rounded-2xl bg-destructive/10 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="type-footnote flex-1 text-foreground">{failed.message}</p>
                </div>
                <Button size="sm" variant="outline" className="mt-2.5" onClick={() => send(failed.question)}>
                  <RotateCcw className="size-4" /> נסה שוב
                </Button>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      )}

      {/* Sticky composer, clearing the fixed bottom nav that TripLayout renders.
          The nav carries `safe-bottom`, so its height grows with the device's
          safe area — the offset has to grow with it. */}
      <div className="material sticky bottom-[calc(env(safe-area-inset-bottom,0px)+68px)] -mx-4 border-t border-separator px-4 py-2.5">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            placeholder="שאל על הטיול…"
            aria-label="שאלה לסוכן"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl py-2.5"
          />
          <button
            type="button"
            disabled={!draft.trim() || thinking}
            onClick={() => send(draft)}
            aria-label="שלח"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-40"
          >
            {thinking ? <Spinner className="size-5" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </div>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="השיחה עם הסוכן">
        <div className="flex flex-col gap-2">
          <SheetRow
            icon={<Trash2 className="size-5" />}
            label="מחיקת השיחה"
            hint="השיחה שלך עם הסוכן בטיול הזה. אי אפשר לשחזר."
            destructive
            onClick={() => {
              setMenuOpen(false);
              clearChat();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

/**
 * The agent is told to answer in plain text, but models still slip in
 * **bold**. Render those runs as <strong> (React text nodes — no HTML is
 * parsed) and drop any stray asterisks, so users never see raw markup.
 */
function richText(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part.replace(/\*\*/g, "")
    ),
  );
}
