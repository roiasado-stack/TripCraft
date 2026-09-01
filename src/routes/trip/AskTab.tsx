import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Heart, Send, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AgentCard, TripChatMessage } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Chip, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { askAgent, type AskTurn } from "@/lib/ai";
import { MapLink } from "@/components/MapLink";
import { suggestionKindLabel } from "@/lib/trip-options";
import { resolveMapUrl } from "@/lib/maps";
import { cn } from "@/lib/utils";

const STARTERS = [
  "מה עושים ביום גשום?",
  "איפה אוכלים בסביבת המלון?",
  "מה כדאי להזמין מראש?",
  "מה מתאים לילדים הקטנים?",
];

export default function AskTab() {
  const { trip } = useTrip();
  const toast = useToast();
  const [messages, setMessages] = useState<TripChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);

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
    if (!question || thinking) return;
    setDraft("");
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

    if (!res.ok) {
      if (res.error === "not_deployed") toast.error("הסוכן עדיין לא הופעל. ראה README (Edge Function).");
      else if (res.error === "forbidden") toast.error("אין לך הרשאה לשאול על הטיול הזה.");
      else toast.error("הסוכן לא הצליח לענות. נסה שוב.");
      return;
    }

    const { data: botRow } = await supabase
      .from("trip_chat_messages")
      .insert({ trip_id: trip.id, role: "assistant", content: res.answer, cards: res.cards ?? [] })
      .select()
      .single();
    if (botRow) setMessages((m) => [...m, botRow as TripChatMessage]);
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
      toast.error("ההוספה נכשלה. ודא שהרצת את מיגרציה 002.");
      return;
    }
    setAdded((a) => ({ ...a, [key]: true }));
    toast.success("נוסף למומלצים ✨");
  };

  const addToItinerary = async (card: AgentCard, key: string) => {
    const day = trip.start_date ?? new Date().toISOString().slice(0, 10);
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
    await supabase.from("trip_chat_messages").delete().eq("trip_id", trip.id);
    setMessages([]);
    setAdded({});
    toast.success("השיחה נמחקה");
  };

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="שאלות והמלצות" />
      <ScreenTitle
        title="שאל את הסוכן"
        action={
          messages.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={clearChat}>
              נקה שיחה
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          {messages.length === 0 && (
            <Card className="p-4">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-primary">
                <Sparkles className="size-4" /> מה בא לך לדעת על {trip.destination}?
              </div>
              <p className="text-sm text-muted-foreground">
                הסוכן מכיר את התאריכים, המשתתפים והמסלול שלך. שאל אותו כל דבר, או התחל מאחת מאלה:
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STARTERS.map((s) => (
                  <Chip key={s} active={false} onClick={() => send(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Card>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[85%]", m.role === "assistant" && "w-full")}>
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-3xl px-4 py-3 text-[15px] leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-card-foreground",
                  )}
                >
                  {m.content}
                </div>

                {m.cards?.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {m.cards.map((card, idx) => {
                      const key = `${m.id}:${idx}`;
                      return (
                        <Card key={key} className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-bold leading-snug">{card.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {suggestionKindLabel(card.kind)}
                              </div>
                            </div>
                            <MapLink url={resolveMapUrl(null, card.location ?? card.title, trip.destination)} />
                          </div>
                          {card.description && (
                            <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{card.description}</p>
                          )}
                          <div className="mt-2.5 flex gap-1.5">
                            <Button
                              size="sm"
                              variant="soft"
                              disabled={added[key]}
                              onClick={() => addToSuggestions(card, key)}
                            >
                              <Heart className="size-4" /> {added[key] ? "נוסף" : "למומלצים"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={added[key]}
                              onClick={() => addToItinerary(card, key)}
                            >
                              <CalendarPlus className="size-4" /> למסלול
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex justify-end">
              <div className="flex items-center gap-2 rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                <Spinner /> הסוכן חושב…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* Sticky composer, clearing the fixed bottom nav that TripLayout renders.
          The nav carries `safe-bottom`, so its height grows with the device's
          safe area — the offset has to grow with it. */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+68px)] -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
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
            className="max-h-32 min-h-11 flex-1 resize-none py-2.5"
          />
          <Button size="icon" loading={thinking} disabled={!draft.trim()} onClick={() => send(draft)} aria-label="שלח">
            {!thinking && <Send className="size-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
