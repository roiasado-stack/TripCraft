import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Compass, Heart, List, Map as MapIcon, MapPin, MessageCircle, MoreHorizontal, Navigation, PenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Suggestion } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { Button, Card, Chip, EmptyState, Field, GroupedList, Input, Modal, SheetRow, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { useSuggestionPhoto } from "@/lib/photos";
import { FillPhotos } from "@/components/FillPhotos";
import { aiErrorMessage, generateContent, searchCoordinates, searchPhoto, type TuneOption } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { SUGGESTION_KINDS } from "@/lib/trip-options";
import { destinationPicks, pickToRow } from "@/lib/destinations";
import { LinkChip } from "@/components/MapLink";
import { directionsUrl, isSafeHttpUrl, resolveMapUrl, vegetarianSearchUrl } from "@/lib/maps";
import { KosherPanel } from "@/components/KosherPanel";
import { CardCoverImage } from "@/components/MediaCard";
import { TripMap, type TripMapItem } from "@/components/TripMap";
import { localDateString } from "@/lib/trip-dates";
import { isPhotoUrl } from "@/lib/photo-url";

const TUNE: { value: TuneOption; label: string }[] = [
  { value: "more_kids", label: "יותר ידידותי לילדים" },
  { value: "calmer", label: "יותר רגוע" },
  { value: "cheaper", label: "תקציב נמוך" },
  { value: "more_active", label: "יותר אקטיבי" },
];

export default function SuggestionsTab() {
  const { trip, role, participants } = useTrip();
  const canParticipate = can(role, "participate");
  const canEdit = can(role, "edit");
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
  const [view, setView] = useState<"list" | "map">("list");
  const [addOpen, setAddOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<Suggestion | null>(null);

  /** Curated + generic highlights for the destination, matched to the group. */
  const addDestinationPicks = async () => {
    // Already running (the sheet closes at once, so a second tap is easy): two runs
    // would both check the same old list and insert every pick twice.
    if (picking) return;
    setPicking(true);
    try {
      const ages = participants
        .map((p) => p.age ?? (p.age_range ? Number(p.age_range.match(/^(\d+)/)?.[1]) : null))
        .filter((n): n is number => n != null && !isNaN(n));
      const prefs = [...new Set(participants.flatMap((p) => p.preferences ?? []))];
      const picks = destinationPicks(trip.destination, { style: trip.trip_type, ages, prefs });

      const existing = new Set(items.map((i) => i.title));
      const baseRows = picks
        .filter((p) => !existing.has(p.title))
        .map((p) => pickToRow(p, trip.id, trip.destination));
      if (!baseRows.length) {
        toast.toast("כל ההמלצות המובילות כבר קיימות");
        return;
      }
      const photoResults = await Promise.allSettled(
        baseRows.map((r) => searchPhoto(trip.id, `${r.title} ${trip.destination}`)),
      );
      const rows = baseRows.map((r, idx) => {
        const photo = photoResults[idx];
        return { ...r, image_url: photo.status === "fulfilled" ? photo.value : null };
      });
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

  // Numbered in the same order `filtered` renders in — see CLAUDE.md.
  const mapItems: TripMapItem[] = useMemo(
    () =>
      filtered
        .filter((s): s is Suggestion & { lat: number; lng: number } => s.lat != null && s.lng != null)
        .map((s, idx) => ({ id: s.id, lat: s.lat, lng: s.lng, title: s.title, subtitle: s.description ?? undefined, number: idx + 1 })),
    [filtered],
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
    const day = trip.start_date ?? localDateString(new Date());
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
    } else {
      toast.error(aiErrorMessage(res.error, "יצירת ההמלצות נכשלה. נסו שוב."));
    }
  };

  const saveManual = async () => {
    if (!manual?.title.trim()) {
      toast.error("צריך שם");
      return;
    }
    const query = `${manual.title.trim()} ${trip.destination}`;
    const [image_url, coords] = await Promise.all([searchPhoto(trip.id, query), searchCoordinates(trip.id, query)]);
    await supabase.from("suggestions").insert({
      trip_id: trip.id,
      kind: manual.kind,
      title: manual.title.trim(),
      description: manual.description || null,
      image_url,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
    setManual(null);
    toast.success("נוסף");
    load();
  };

  // Places with a photo (attractions, restaurants) read best as photo cards; tips and
  // gear have no photo and read best as a quiet list.
  const placeKinds = new Set(["attraction", "restaurant"]);
  const places = filtered.filter((i) => placeKinds.has(i.kind));
  const notes = filtered.filter((i) => !placeKinds.has(i.kind));
  const actionsMapUrl = actionsFor
    ? resolveMapUrl(actionsFor.map_url, actionsFor.location ?? actionsFor.title, trip.destination)
    : null;
  const actionsDirections = actionsFor ? directionsUrl(actionsFor.location ?? actionsFor.title, trip.destination) : null;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="אטרקציות ומסעדות" />

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">מומלצים</h2>
        <div className="flex items-center gap-1">
          {!loading && filtered.length > 0 && (
            <button
              type="button"
              onClick={() => setView(view === "list" ? "map" : "list")}
              aria-label={view === "list" ? "תצוגת מפה" : "תצוגת רשימה"}
              className="grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
            >
              {view === "list" ? <MapIcon className="size-5" /> : <List className="size-5" />}
            </button>
          )}
          {canParticipate && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              aria-label="הוספת המלצות"
              className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
            >
              <Plus className="size-5" />
            </button>
          )}
        </div>
      </div>

      {/* One row of filters, scrolling sideways instead of wrapping onto a second line. */}
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&>*]:shrink-0 [&>*]:whitespace-nowrap">
        <Chip active={filter === "all" && !onlyLiked} onClick={() => { setFilter("all"); setOnlyLiked(false); }}>
          הכל
        </Chip>
        {SUGGESTION_KINDS.map((k) => (
          <Chip key={k.value} active={filter === k.value} onClick={() => setFilter(filter === k.value ? "all" : k.value)}>
            {k.emoji} {k.label}
          </Chip>
        ))}
        <Chip active={onlyLiked} onClick={() => setOnlyLiked((v) => !v)}>
          <Heart className={cn("size-3.5", onlyLiked && "fill-current")} /> אהבתי
        </Chip>
      </div>

      {canEdit && (
        <FillPhotos
          tripId={trip.id}
          destination={trip.destination}
          missing={items.filter((i) => i.kind === "attraction" && !isPhotoUrl(i.image_url)).length}
          onDone={load}
        />
      )}

      {/* Kosher: tiered results (verified / on the map / no info) plus live search links. */}
      {needsKosher && <KosherPanel trip={trip} />}

      {/* Vegetarian: a live search, because venues change often. */}
      {needsVeg && (
        <Card className="mb-3 p-3">
          <div className="mb-1.5 text-sm font-bold">🥗 אוכל צמחוני ב{trip.destination}</div>
          <div className="flex flex-wrap gap-1.5">
            <LinkChip url={vegetarianSearchUrl(trip.destination)} label="צמחוני / טבעוני" />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">חיפוש חי — תמיד מעודכן.</p>
        </Card>
      )}

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
            items.length === 0 && canParticipate ? (
              <Button onClick={() => setShowGen(true)}>
                <Sparkles className="size-4" /> יצירת המלצות
              </Button>
            ) : undefined
          }
        />
      ) : view === "map" ? (
        mapItems.length === 0 ? (
          <EmptyState emoji="🗺️" title="אין עדיין מיקומים על המפה" description="הוסיפו פריטים עם מיקום כדי לראות אותם על המפה." />
        ) : (
          <TripMap items={mapItems} />
        )
      ) : (
        <div className="flex flex-col gap-4">
          {places.map((s) => {
            const kind = SUGGESTION_KINDS.find((k) => k.value === s.kind);
            return (
              <article key={s.id} className="overflow-hidden rounded-3xl bg-card text-card-foreground">
                <SuggestionCover
                  s={s}
                  tripId={trip.id}
                  destination={trip.destination}
                  canResolve={canEdit}
                  icon={<span className="text-4xl">{kind?.emoji ?? "📍"}</span>}
                  cornerSlot={
                    canParticipate ? (
                      <button
                        type="button"
                        onClick={() => toggleLike(s)}
                        aria-label={s.liked ? "הסרה מאהבתי" : "אהבתי"}
                        aria-pressed={s.liked}
                        className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-transform active:scale-90"
                      >
                        <Heart className={cn("size-5", s.liked && "fill-current text-accent")} />
                      </button>
                    ) : null
                  }
                >
                  <div className="type-footnote font-semibold text-white">
                    {kind?.emoji} {kind?.label}
                  </div>
                  <div className="type-title line-clamp-2 text-white [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{s.title}</div>
                </SuggestionCover>
                {(s.description || s.tags?.length > 0) && (
                  <div className="px-4 pt-3">
                    {s.description && <p className="type-footnote line-clamp-3 text-muted-foreground">{s.description}</p>}
                    <SuggestionTags tags={s.tags} />
                  </div>
                )}
                <div className="flex items-center gap-2 px-2 py-2">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => addToItinerary(s)}
                      className="type-headline flex min-h-11 items-center gap-1.5 rounded-full px-3 text-primary transition-colors active:bg-muted/70"
                    >
                      <CalendarPlus className="size-5" /> למסלול
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActionsFor(s)}
                    aria-label={`אפשרויות ל${s.title}`}
                    className="ms-auto grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                  >
                    <MoreHorizontal className="size-5" />
                  </button>
                </div>
              </article>
            );
          })}

          {notes.length > 0 && (
            <GroupedList title={filter === "all" ? "טיפים וציוד" : undefined}>
              {notes.map((s) => {
                const kind = SUGGESTION_KINDS.find((k) => k.value === s.kind);
                return (
                  <div key={s.id} className="flex items-start gap-3 py-3 ps-4 pe-1">
                    <span className="mt-0.5 text-xl" aria-hidden>
                      {kind?.emoji ?? "💡"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="type-headline [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{s.title}</div>
                      {s.description && (
                        <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>
                      )}
                      <SuggestionTags tags={s.tags} />
                    </div>
                    {canParticipate && (
                      <button
                        type="button"
                        onClick={() => toggleLike(s)}
                        aria-label={s.liked ? "הסרה מאהבתי" : "אהבתי"}
                        aria-pressed={s.liked}
                        className={cn(
                          "grid size-11 shrink-0 place-items-center rounded-full transition-colors active:bg-muted/70",
                          s.liked ? "text-accent" : "text-muted-foreground",
                        )}
                      >
                        <Heart className={cn("size-5", s.liked && "fill-current")} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActionsFor(s)}
                      aria-label={`אפשרויות ל${s.title}`}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                  </div>
                );
              })}
            </GroupedList>
          )}
        </div>
      )}

      {/* Every way to add, behind one "+" */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="הוספת המלצות">
        <div className="flex flex-col gap-2">
          <SheetRow
            icon={<Sparkles className="size-5" />}
            label="יצירה עם AI"
            hint="מותאם לגילאים ולהעדפות של המשתתפים"
            onClick={() => {
              setAddOpen(false);
              setShowGen(true);
            }}
          />
          <SheetRow
            icon={<Compass className="size-5" />}
            label="המקומות המובילים ביעד"
            hint={picking ? "מוסיף…" : undefined}
            onClick={() => {
              setAddOpen(false);
              addDestinationPicks();
            }}
          />
          <SheetRow
            icon={<PenLine className="size-5" />}
            label="הוספה ידנית"
            onClick={() => {
              setAddOpen(false);
              setManual({ kind: "attraction", title: "", description: "" });
            }}
          />
          <SheetRow
            icon={<MessageCircle className="size-5" />}
            label="שאל את הסוכן"
            onClick={() => {
              setAddOpen(false);
              navigate("../ask");
            }}
          />
        </div>
      </Modal>

      {/* One suggestion's secondary actions */}
      <Modal open={!!actionsFor} onClose={() => setActionsFor(null)} title={actionsFor?.title ?? ""}>
        {actionsFor && (
          <div className="flex flex-col gap-2">
            {actionsMapUrl && isSafeHttpUrl(actionsMapUrl) && (
              <SheetRow icon={<MapPin className="size-5" />} label="פתיחה במפה" href={actionsMapUrl} />
            )}
            {actionsDirections && <SheetRow icon={<Navigation className="size-5" />} label="ניווט" href={actionsDirections} />}
            {/* Place cards show "למסלול" on the card itself; tips and gear keep it here. */}
            {canEdit && !placeKinds.has(actionsFor.kind) && (
              <SheetRow
                icon={<CalendarPlus className="size-5" />}
                label="הוספה למסלול"
                onClick={() => {
                  const item = actionsFor;
                  setActionsFor(null);
                  addToItinerary(item);
                }}
              />
            )}
            {canEdit && (
              <SheetRow
                icon={<Trash2 className="size-5" />}
                label="מחיקה"
                destructive
                onClick={() => {
                  const id = actionsFor.id;
                  setActionsFor(null);
                  remove(id);
                }}
              />
            )}
          </div>
        )}
      </Modal>

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

/** Cover photo for one suggestion: Wikipedia, then Google, then ambience (see useSuggestionPhoto). */
function SuggestionCover({
  s,
  tripId,
  destination,
  canResolve,
  icon,
  cornerSlot,
  children,
}: {
  s: Suggestion;
  tripId: string;
  destination: string;
  canResolve: boolean;
  icon: React.ReactNode;
  cornerSlot: React.ReactNode;
  children?: React.ReactNode;
}) {
  const photo = useSuggestionPhoto({
    tripId,
    destination,
    id: s.id,
    kind: s.kind,
    title: s.title,
    imageUrl: s.image_url,
    placeId: s.google_place_id,
    lat: s.lat,
    lng: s.lng,
    canResolve,
  });
  return (
    <CardCoverImage
      imageUrl={photo.url}
      illustrative={photo.illustrative}
      googlePhoto={photo.google}
      alt={s.title}
      gradient="sea"
      icon={icon}
      cornerSlot={cornerSlot}
      className="rounded-t-none"
    >
      {children}
    </CardCoverImage>
  );
}

/** A suggestion's tags. A saved suggestion is never a kosher source — say so next to the claim. */
function SuggestionTags({ tags }: { tags?: string[] | null }) {
  if (!tags?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {t}
          {/כשר|kosher/i.test(t) && " · לא מאומת"}
        </span>
      ))}
    </div>
  );
}
