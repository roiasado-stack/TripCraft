import { useEffect, useMemo, useState } from "react";
import { FileUp, Flame, List, Map as MapIcon, MapPin, MoreHorizontal, Navigation, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ItineraryItem, ShabbatDay, ShabbatInfo } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { Button, EmptyState, Field, Input, Label, Modal, SheetRow, Spinner, Textarea } from "@/components/ui";
import { ImportItinerary } from "@/components/ImportItinerary";
import { CardThumbnail } from "@/components/MediaCard";
import { directionsUrl, isSafeHttpUrl, mapsUrl, resolveMapUrl } from "@/lib/maps";
import { useToast } from "@/hooks/use-toast";
import { ambientPhoto } from "@/lib/photos";
import { FillPhotos } from "@/components/FillPhotos";
import { aiErrorMessage, generateContent, lookupKosher, searchCoordinates, searchPhoto } from "@/lib/ai";
import { daysBetween, formatDayHeb, ITINERARY_CATEGORIES, itineraryCategory } from "@/lib/trip-options";
import { TripMap, type TripMapItem } from "@/components/TripMap";
import { localDateString, parseLocalDate } from "@/lib/trip-dates";
import { isPhotoUrl } from "@/lib/photo-url";
import { cn } from "@/lib/utils";

/**
 * Departure-day flights leave from the origin airport, so scoping them to the
 * destination would point the map at the wrong country. Everything else is
 * at the destination and benefits from the extra context.
 */
function scopeFor(category: string, destination: string): string | null {
  return category === "flight" ? null : destination;
}

/**
 * Whether an item falls inside Shabbat / yom tov: on a restricted day, any time
 * before havdalah (or all day, when it runs into a second day); on an erev,
 * from candle lighting. An item with no time on a restricted day counts — the
 * warning is a nudge to check, not a ruling.
 */
function shabbatConflict(day: ShabbatDay | undefined, startTime: string | null): boolean {
  if (!day) return false;
  const t = startTime?.slice(0, 5) ?? null;
  if (day.restricted) return !(day.havdalah && t && t >= day.havdalah);
  return !!(day.candles && t && t >= day.candles);
}

/** The yom tov that starts this evening, if tomorrow is one (for erev labels). */
function nextDayHoliday(byDate: Map<string, ShabbatDay>, date: string): string | null {
  const next = parseLocalDate(date);
  if (!next) return null;
  next.setDate(next.getDate() + 1);
  return byDate.get(localDateString(next))?.holiday ?? null;
}

type Draft = {
  id?: string;
  day_date: string;
  start_time: string;
  title: string;
  description: string;
  category: string;
  location: string;
  /** The item's CURRENT photo, if it already has one — never user-typed.
   *  Reused as-is on save; only missing photos trigger a fresh search. */
  image_url: string | null;
  /** The item's CURRENT coordinates, same "don't clobber" rule as image_url
   *  — only re-geocoded when both are still null. */
  lat: number | null;
  lng: number | null;
};

export default function ItineraryTab() {
  const { trip, role, participants } = useTrip();
  const canEdit = can(role, "edit");
  const toast = useToast();
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [shabbat, setShabbat] = useState<ShabbatInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<ItineraryItem | null>(null);

  // Shabbat / yom tov times (Hebcal, via the ask function — no model, no
  // Google) for trips where someone keeps kosher.
  const keepsKosher = participants.some((p) => p.preferences?.includes("kosher"));
  useEffect(() => {
    if (!keepsKosher || !trip.start_date || !trip.end_date) {
      setShabbat(null);
      return;
    }
    let live = true;
    lookupKosher(trip.id, { shabbatOnly: true }).then((r) => live && setShabbat(r?.shabbat ?? null));
    return () => {
      live = false;
    };
  }, [keepsKosher, trip.id, trip.start_date, trip.end_date]);
  const shabbatByDate = useMemo(() => new Map((shabbat?.days ?? []).map((d) => [d.date, d])), [shabbat]);

  const load = async () => {
    const { data } = await supabase
      .from("itinerary_items")
      .select("*")
      .eq("trip_id", trip.id)
      .order("day_date")
      .order("start_time", { nullsFirst: true })
      .order("sort_order");
    setItems((data as ItineraryItem[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const days = useMemo(() => {
    const set = new Set<string>();
    if (trip.start_date && trip.end_date) daysBetween(trip.start_date, trip.end_date).forEach((d) => set.add(d));
    items.forEach((i) => set.add(i.day_date));
    return [...set].sort();
  }, [trip.start_date, trip.end_date, items]);

  const grouped = useMemo(() => {
    const map: Record<string, ItineraryItem[]> = {};
    items.forEach((i) => {
      (map[i.day_date] ??= []).push(i);
    });
    return map;
  }, [items]);

  // `items` is already queried in day_date/start_time/sort_order order — the
  // same order the list view groups and renders in — so numbering markers by
  // that array's index gives day+time order for free.
  const mapItems: TripMapItem[] = useMemo(
    () =>
      items
        .filter((i): i is ItineraryItem & { lat: number; lng: number } => i.lat != null && i.lng != null)
        .map((i, idx) => ({
          id: i.id,
          lat: i.lat,
          lng: i.lng,
          title: i.title,
          subtitle: i.location ?? undefined,
          number: idx + 1,
        })),
    [items],
  );

  const defaultDay = trip.start_date ?? localDateString(new Date());

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("צריך כותרת לפריט");
      return;
    }
    // Reuse an existing photo/coordinates as-is (editing a typo shouldn't
    // re-roll a good AI-picked photo, or move a pin the user already placed)
    // — only search/geocode when the item has none yet.
    const query = `${editing.title.trim()} ${trip.destination}`;
    const [image_url, coords] = await Promise.all([
      editing.image_url ? Promise.resolve(editing.image_url) : searchPhoto(trip.id, query),
      editing.lat == null && editing.lng == null ? searchCoordinates(trip.id, query) : Promise.resolve(null),
    ]);
    const payload = {
      trip_id: trip.id,
      day_date: editing.day_date,
      start_time: editing.start_time || null,
      title: editing.title.trim(),
      description: editing.description || null,
      category: editing.category,
      location: editing.location || null,
      map_url: editing.location
        ? mapsUrl(editing.location, scopeFor(editing.category, trip.destination))
        : null,
      image_url,
      lat: editing.lat ?? coords?.lat ?? null,
      lng: editing.lng ?? coords?.lng ?? null,
    };
    const { error } = editing.id
      ? await supabase.from("itinerary_items").update(payload).eq("id", editing.id)
      : await supabase.from("itinerary_items").insert(payload);
    if (error) {
      toast.error("השמירה נכשלה. נסו שוב.");
      return;
    }
    setEditing(null);
    toast.success("נשמר");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("itinerary_items").delete().eq("id", id);
    if (error) {
      toast.error("המחיקה נכשלה. נסו שוב.");
      return;
    }
    toast.success("הפריט נמחק");
    load();
  };

  const generate = async () => {
    setGenerating(true);
    const res = await generateContent(trip, participants, "itinerary");
    setGenerating(false);
    if (res.ok) {
      toast.success(`נוצר מסלול מוצע (${res.inserted} פריטים) ✨`);
      load();
    } else {
      toast.error(aiErrorMessage(res.error, "יצירת המסלול נכשלה. נסו שוב."));
    }
  };

  const newItem = (day: string): Draft => ({
    day_date: day,
    start_time: "",
    title: "",
    description: "",
    category: "activity",
    location: "",
    image_url: null,
    lat: null,
    lng: null,
  });
  const scope = actionsFor ? scopeFor(actionsFor.category, trip.destination) : null;
  const actionsMapUrl = actionsFor?.location ? resolveMapUrl(actionsFor.map_url, actionsFor.location, scope) : null;
  const actionsDirections = actionsFor?.location ? directionsUrl(actionsFor.location, scope) : null;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="המסלול היומי" />

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">מסלול</h2>
        <div className="flex items-center gap-1">
          {!loading && days.length > 0 && (
            <button
              type="button"
              onClick={() => setView(view === "list" ? "map" : "list")}
              aria-label={view === "list" ? "תצוגת מפה" : "תצוגת רשימה"}
              className="grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
            >
              {view === "list" ? <MapIcon className="size-5" /> : <List className="size-5" />}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              aria-label="הוספה למסלול"
              className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
            >
              {generating ? <Spinner className="size-5" /> : <Plus className="size-5" />}
            </button>
          )}
        </div>
      </div>

      {canEdit && (
        <FillPhotos
          tripId={trip.id}
          destination={trip.destination}
          missing={items.filter((i) => i.category === "activity" && !isPhotoUrl(i.image_url)).length}
          onDone={load}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : days.length === 0 ? (
        <EmptyState
          emoji="🗓️"
          title="עדיין אין מסלול"
          description={canEdit ? "הוסף תאריכים לטיול או פריט ראשון, או תן ל-AI להציע מסלול יומי." : "בעל הטיול עוד לא בנה מסלול."}
          action={
            canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setEditing(newItem(defaultDay))}>
                  <Plus className="size-4" /> הוספת פריט
                </Button>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <FileUp className="size-4" /> ייבוא מסלול
                </Button>
              </div>
            )
          }
        />
      ) : view === "map" ? (
        mapItems.length === 0 ? (
          <EmptyState emoji="🗺️" title="אין עדיין מיקומים על המפה" description="הוסיפו פריטים עם מיקום כדי לראות אותם על המפה." />
        ) : (
          <TripMap items={mapItems} />
        )
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day, idx) => {
            const sh = shabbatByDate.get(day);
            const erevOf = sh && !sh.restricted ? nextDayHoliday(shabbatByDate, day) : null;
            const dayItems = grouped[day] ?? [];
            return (
              <section key={day}>
                <div className="mb-1.5 flex items-baseline gap-2 px-1">
                  <span className="type-footnote font-semibold text-primary">יום {idx + 1}</span>
                  <h3 className="type-headline">{formatDayHeb(day)}</h3>
                </div>
                <div className="divide-y divide-separator overflow-hidden rounded-2xl bg-card text-card-foreground">
                  {sh && (
                    <div className="type-footnote flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/60 px-4 py-2 font-semibold">
                      <Flame className="size-3.5 text-accent" />
                      {sh.holiday && <span>{sh.holiday}</span>}
                      {erevOf && <span>ערב {erevOf}</span>}
                      {sh.candles && (
                        <span>
                          {/* On Shabbat / yom tov itself, the next night's candles are lit after dark from an existing flame. */}
                          {sh.restricted ? `הדלקת נרות לא לפני ${sh.candles}, מאש קיימת` : `הדלקת נרות ${sh.candles}`}
                        </span>
                      )}
                      {sh.havdalah && <span>הבדלה {sh.havdalah}</span>}
                      {!sh.candles && !sh.havdalah && <span>שבת / חג</span>}
                    </div>
                  )}
                  {dayItems.map((it) => {
                    const cat = itineraryCategory(it.category);
                    const conflict = shabbatConflict(sh, it.start_time);
                    return (
                      <div key={it.id} className="flex items-start gap-3 py-3 ps-4 pe-1">
                        <CardThumbnail
                          imageUrl={(isPhotoUrl(it.image_url) ? it.image_url : null) ?? ambientPhoto(it.category === "food", it.title)}
                          illustrative={!isPhotoUrl(it.image_url) && it.category === "food"}
                          alt={it.title}
                          gradient="sunset"
                          size="size-11"
                          rounded="rounded-xl"
                          icon={<span className="text-lg">{cat.emoji}</span>}
                        />
                        <div className="min-w-0 flex-1">
                          {it.start_time && (
                            <div className="type-footnote font-semibold tabular-nums text-primary">{it.start_time.slice(0, 5)}</div>
                          )}
                          <div className="type-headline line-clamp-2 [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{it.title}</div>
                          {it.location && (
                            <div className="type-footnote truncate text-muted-foreground [unicode-bidi:plaintext]">{it.location}</div>
                          )}
                          {conflict && (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sun px-2 py-0.5 text-[11px] font-semibold text-sun-foreground">
                              <TriangleAlert className="size-3" />
                              {(sh!.restricted ? sh!.holiday : erevOf) ? "בחג" : "בשבת"}
                              {sh!.havdalah ? ` — לפני ההבדלה (${sh!.havdalah})` : ""}
                            </div>
                          )}
                          {it.description && (
                            <p className="type-footnote mt-0.5 line-clamp-3 text-muted-foreground [overflow-wrap:anywhere]">{it.description}</p>
                          )}
                        </div>
                        {(canEdit || it.location) && (
                          <button
                            type="button"
                            onClick={() => setActionsFor(it)}
                            aria-label={`אפשרויות עבור ${it.title}`}
                            className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                          >
                            <MoreHorizontal className="size-5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {dayItems.length === 0 && !canEdit && (
                    <p className="type-footnote px-4 py-3 text-muted-foreground">אין עדיין תוכניות ליום הזה.</p>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(newItem(day))}
                      className={cn(
                        "type-headline flex min-h-12 w-full items-center gap-2 px-4 py-3 text-start text-primary transition-colors active:bg-muted/70",
                      )}
                    >
                      <Plus className="size-5" /> הוספה ליום זה
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Every way to add, behind one "+" */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="הוספה למסלול">
        <div className="flex flex-col gap-2">
          <SheetRow
            icon={<Plus className="size-5" />}
            label="פריט חדש"
            onClick={() => {
              setAddOpen(false);
              setEditing(newItem(defaultDay));
            }}
          />
          <SheetRow
            icon={<Sparkles className="size-5" />}
            label="מסלול מוצע עם AI"
            hint={generating ? "בתהליך… זה לוקח כמה שניות" : "לפי המשתתפים, ההעדפות והתאריכים"}
            onClick={() => {
              setAddOpen(false);
              if (!generating) generate();
            }}
          />
          <SheetRow
            icon={<FileUp className="size-5" />}
            label="ייבוא מסלול"
            hint="מקובץ Excel או מטקסט"
            onClick={() => {
              setAddOpen(false);
              setImporting(true);
            }}
          />
        </div>
      </Modal>

      {/* One item's actions */}
      <Modal open={!!actionsFor} onClose={() => setActionsFor(null)} title={actionsFor?.title ?? ""}>
        {actionsFor && (
          <div className="flex flex-col gap-2">
            {actionsMapUrl && isSafeHttpUrl(actionsMapUrl) && (
              <SheetRow icon={<MapPin className="size-5" />} label="פתיחה במפה" href={actionsMapUrl} />
            )}
            {actionsDirections && <SheetRow icon={<Navigation className="size-5" />} label="ניווט" href={actionsDirections} />}
            {canEdit && (
              <SheetRow
                icon={<Pencil className="size-5" />}
                label="עריכה"
                onClick={() => {
                  const it = actionsFor;
                  setActionsFor(null);
                  setEditing({
                    id: it.id,
                    day_date: it.day_date,
                    start_time: it.start_time ?? "",
                    title: it.title,
                    description: it.description ?? "",
                    category: it.category,
                    location: it.location ?? "",
                    image_url: it.image_url ?? null,
                    lat: it.lat ?? null,
                    lng: it.lng ?? null,
                  });
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

      {shabbat && shabbat.days.length > 0 && view === "list" && (
        <p className="mt-4 text-[11px] text-muted-foreground">
          זמני שבת וחג לפי{" "}
          <a href={shabbat.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Hebcal.com
          </a>{" "}
          (CC BY 4.0), לפי מיקום היעד{shabbat.tzid ? ` ובשעון המקומי (${shabbat.tzid})` : ""}. חישוב אוטומטי, יש לבדוק מול
          בית חב״ד או רב מקומי.
        </p>
      )}

      <ImportItinerary
        trip={trip}
        open={importing}
        onClose={() => setImporting(false)}
        onImported={load}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "עריכת פריט" : "פריט חדש"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={save}>
              שמירה
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="כותרת">
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="לדוגמה: ביקור בפארק" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך">
                <Input type="date" value={editing.day_date} onChange={(e) => setEditing({ ...editing, day_date: e.target.value })} />
              </Field>
              <Field label="שעה">
                <Input type="time" value={editing.start_time} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} />
              </Field>
            </div>
            <div>
              <Label>קטגוריה</Label>
              <div className="flex flex-wrap gap-1.5">
                {ITINERARY_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setEditing({ ...editing, category: c.value })}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${editing.category === c.value ? "border-primary bg-primary-soft" : "border-border"}`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="מיקום">
              <Input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} placeholder="כתובת / שם מקום" />
            </Field>
            <Field label="פרטים">
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="הערות, טיפים…" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
