import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Compass, Heart, MessageCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Suggestion } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Chip, EmptyState, Field, Input, Modal, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { generateContent, type TuneOption } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { SUGGESTION_KINDS } from "@/lib/trip-options";
import { destinationPicks, pickToRow } from "@/lib/destinations";
import { DirectionsLink, LinkChip, MapLink } from "@/components/MapLink";
import { chabadSearchUrl, kosherSearchUrl, resolveMapUrl, vegetarianSearchUrl } from "@/lib/maps";

const TUNE: { value: TuneOption; label: string }[] = [
  { value: "more_kids", label: "יותר ידידותי לילדים" },
  { value: "calmer", label: "יותר רגוע" },
  { value: "cheaper", label: "תקציב נמוך" },
  { value: "more_active", label: "יותר אקטיבי" },
];

export default function SuggestionsTab() {
  const { trip, participants } = useTrip();
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [onlyLiked, setOnlyLiked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [tune, setTune] = useState<TuneOption | null>(null);
  const [manual, setManual] = useState<{ kind: string; title: string; description: string } | null>(null);
  const [picking, setPicking] = useState(false);

  /** Curated + generic highlights for the destination, matched to the group. */
  const addDestinationPicks = async () => {
    setPicking(true);
    try {
      const ages = participants
        .map((p) => p.age ?? (p.age_range ? Number(p.age_range.match(/^(\d+)/)?.[1]) : null))
        .filter((n): n is number => n != null && !isNaN(n));
      const prefs = [...new Set(participants.flatMap((p) => p.preferences ?? []))];
      const picks = destinationPicks(trip.destination, { style: trip.trip_type, ages, prefs });

      const existing = new Set(items.map((i) => i.title));
      const rows = picks
        .filter((p) => !existing.has(p.title))
        .map((p) => pickToRow(p, trip.id, trip.destination));
      if (!rows.length) {
        toast.toast("כל ההמלצות המובילות כבר קיימות");
        return;
      }
      const { error } = await supabase.from("suggestions").insert(rows);
      if (error) {
        toast.error("ההוספה נכשלה. ודא שהרצת את מיגרציה 002.");
        return;
      }
      toast.success(`נוספו ${rows.length} המלצות מובילות 🧭`);
      load();
    } finally {
      setPicking(false);
    }
  };

  const load = async () => {
    const { data } = await supabase.from("suggestions").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false });
    setItems((data as Suggestion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const needsKosher = participants.some((p) => p.preferences?.includes("kosher"));
  const needsVeg = participants.some((p) => p.preferences?.includes("vegetarian"));

  const filtered = useMemo(
    () => items.filter((i) => (filter === "all" || i.kind === filter) && (!onlyLiked || i.liked)),
    [items, filter, onlyLiked],
  );

  const toggleLike = async (s: Suggestion) => {
    setItems((x) => x.map((i) => (i.id === s.id ? { ...i, liked: !i.liked } : i)));
    await supabase.from("suggestions").update({ liked: !s.liked }).eq("id", s.id);
  };
  const remove = async (id: string) => {
    setItems((x) => x.filter((i) => i.id !== id));
    await supabase.from("suggestions").delete().eq("id", id);
  };
  const addToItinerary = async (s: Suggestion) => {
    const day = trip.start_date ?? new Date().toISOString().slice(0, 10);
    await supabase.from("itinerary_items").insert({
      trip_id: trip.id,
      day_date: day,
      title: s.title,
      description: s.description,
      category: s.kind === "restaurant" ? "food" : "activity",
    });
    toast.success("נוסף למסלול 🗓️");
  };

  const runGenerate = async () => {
    setGenerating(true);
    const res = await generateContent(trip, participants, "suggestions", tune ?? undefined);
    setGenerating(false);
    setShowGen(false);
    if (res.ok) {
      toast.success(`נוספו ${res.inserted} המלצות ✨`);
      load();
    } else if (res.error === "not_deployed") {
      toast.error("יצירת ה-AI עדיין לא הופעלה. ראה README (Edge Function).");
    } else {
      toast.error("יצירת ה-AI נכשלה. נסה שוב.");
    }
  };

  const saveManual = async () => {
    if (!manual?.title.trim()) {
      toast.error("צריך שם");
      return;
    }
    await supabase.from("suggestions").insert({
      trip_id: trip.id,
      kind: manual.kind,
      title: manual.title.trim(),
      description: manual.description || null,
    });
    setManual(null);
    toast.success("נוסף");
    load();
  };

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="אטרקציות ומסעדות" />
      <ScreenTitle
        title="מומלצים"
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setManual({ kind: "attraction", title: "", description: "" })}>
              <Plus className="size-4" />
            </Button>
            <Button size="sm" variant="outline" loading={picking} onClick={addDestinationPicks}>
              <Compass className="size-4" /> מובילים
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("../ask")}>
              <MessageCircle className="size-4" /> שאל
            </Button>
            <Button size="sm" variant="soft" onClick={() => setShowGen(true)}>
              <Sparkles className="size-4" /> AI
            </Button>
          </div>
        }
      />

      {/* Dietary needs: live searches, because kosher venues change often. */}
      {(needsKosher || needsVeg) && (
        <Card className="mb-3 p-3">
          <div className="mb-1.5 text-sm font-bold">
            {needsKosher ? "🍽️ אוכל כשר ב" : "🥗 אוכל צמחוני ב"}
            {trip.destination}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {needsKosher && <LinkChip url={kosherSearchUrl(trip.destination)} label="מסעדות כשרות" />}
            {needsKosher && <LinkChip url={chabadSearchUrl(trip.destination)} label="בית חב״ד" />}
            {needsVeg && <LinkChip url={vegetarianSearchUrl(trip.destination)} label="צמחוני / טבעוני" />}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            חיפוש חי — תמיד מעודכן. כדאי לאמת כשרות מול בית חב״ד המקומי לפני הנסיעה.
          </p>
        </Card>
      )}

      {/* filters */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          הכל
        </Chip>
        {SUGGESTION_KINDS.map((k) => (
          <Chip key={k.value} active={filter === k.value} onClick={() => setFilter(k.value)}>
            {k.emoji} {k.label}
          </Chip>
        ))}
        <button
          onClick={() => setOnlyLiked((v) => !v)}
          className={cn(
            "mr-auto flex items-center gap-1 rounded-full border px-3 py-2 text-sm font-semibold",
            onlyLiked ? "border-accent bg-accent-soft text-accent" : "border-border",
          )}
        >
          <Heart className={cn("size-4", onlyLiked && "fill-current")} /> אהבתי
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="✨"
          title={items.length === 0 ? "אין עדיין המלצות" : "אין תוצאות לסינון"}
          description={items.length === 0 ? "תן ל-AI להציע אטרקציות ומסעדות מותאמות למשתתפים ולהעדפות שלכם." : undefined}
          action={
            items.length === 0 ? (
              <Button onClick={() => setShowGen(true)}>
                <Sparkles className="size-4" /> יצירת המלצות
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => {
            const kind = SUGGESTION_KINDS.find((k) => k.value === s.kind);
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-xl">{kind?.emoji ?? "📍"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{s.title}</div>
                    {s.description && <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>}
                    {s.tags?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {(s.map_url || s.location) && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pr-14">
                    <MapLink url={resolveMapUrl(s.map_url, s.location ?? s.title, trip.destination)} />
                    <DirectionsLink place={s.location ?? s.title} near={trip.destination} />
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <button onClick={() => toggleLike(s)} className={cn("flex items-center gap-1 text-sm font-semibold", s.liked ? "text-accent" : "text-muted-foreground")}>
                    <Heart className={cn("size-4", s.liked && "fill-current")} /> אהבתי
                  </button>
                  <button onClick={() => addToItinerary(s)} className="flex items-center gap-1 text-sm font-semibold text-primary">
                    <CalendarPlus className="size-4" /> למסלול
                  </button>
                  <button onClick={() => remove(s.id)} className="mr-auto text-destructive" aria-label="מחיקה">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* generate modal */}
      <Modal
        open={showGen}
        onClose={() => setShowGen(false)}
        title="יצירת המלצות עם AI"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setShowGen(false)}>
              ביטול
            </Button>
            <Button className="flex-1" variant="accent" loading={generating} onClick={runGenerate}>
              <Sparkles className="size-4" /> יוצרים
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          ה-AI יתאים אטרקציות, מסעדות וטיפים ל{trip.destination} לפי הגילאים וההעדפות של המשתתפים. אפשר לכוונן:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TUNE.map((t) => (
            <Chip key={t.value} active={tune === t.value} onClick={() => setTune(tune === t.value ? null : t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </Modal>

      {/* manual add modal */}
      <Modal
        open={!!manual}
        onClose={() => setManual(null)}
        title="הוספה ידנית"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setManual(null)}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={saveManual}>
              הוספה
            </Button>
          </>
        }
      >
        {manual && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTION_KINDS.map((k) => (
                <Chip key={k.value} active={manual.kind === k.value} onClick={() => setManual({ ...manual, kind: k.value })}>
                  {k.emoji} {k.label}
                </Chip>
              ))}
            </div>
            <Field label="שם">
              <Input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </Field>
            <Field label="תיאור">
              <Textarea value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
