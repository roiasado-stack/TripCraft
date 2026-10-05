import { useEffect, useMemo, useState } from "react";
import { FileUp, Flame, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ItineraryItem, ShabbatDay, ShabbatInfo } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, EmptyState, Field, Input, Label, Modal, Segmented, Spinner, Textarea } from "@/components/ui";
import { ImportItinerary } from "@/components/ImportItinerary";
import { DirectionsLink, MapLink } from "@/components/MapLink";
import { CardThumbnail } from "@/components/MediaCard";
import { mapsUrl, resolveMapUrl } from "@/lib/maps";
import { useToast } from "@/hooks/use-toast";
import { ambientPhoto } from "@/lib/photos";
import { FillPhotos } from "@/components/FillPhotos";
import { aiErrorMessage, generateContent, lookupKosher, searchCoordinates, searchPhoto } from "@/lib/ai";
import { daysBetween, formatDayHeb, ITINERARY_CATEGORIES, itineraryCategory } from "@/lib/trip-options";
import { TripMap, type TripMapItem } from "@/components/TripMap";

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
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return byDate.get(next.toISOString().slice(0, 10))?.holiday ?? null;
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

  const defaultDay = trip.start_date ?? new Date().toISOString().slice(0, 10);

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
    if (editing.id) {
      await supabase.from("itinerary_items").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("itinerary_items").insert(payload);
    }
    setEditing(null);
    toast.success("נשמר");
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("itinerary_items").delete().eq("id", id);
    setItems((x) => x.filter((i) => i.id !== id));
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

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="המסלול היומי" />
      <ScreenTitle
        title="מסלול"
        action={
          canEdit && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)} aria-label="ייבוא מסלול">
              <FileUp className="size-4" />
            </Button>
            <Button size="sm" variant="soft" loading={generating} onClick={generate}>
              <Sparkles className="size-4" />
              AI
            </Button>
          </div>
          )
        }
      />

      {canEdit && (
        <FillPhotos
          tripId={trip.id}
          destination={trip.destination}
          missing={items.filter((i) => i.category === "activity" && !i.image_url).length}
          onDone={load}
        />
      )}

      {!loading && days.length > 0 && (
        <Segmented
          className="mb-3"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "רשימה", emoji: "📋" },
            { value: "map", label: "מפה", emoji: "🗺️" },
          ]}
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
              <Button onClick={() => setEditing({ day_date: defaultDay, start_time: "", title: "", description: "", category: "activity", location: "", image_url: null, lat: null, lng: null })}>
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
        <div className="flex flex-col gap-5">
          {days.map((day, idx) => (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {idx + 1}
                </span>
                <h3 className="font-bold">{formatDayHeb(day)}</h3>
              </div>
              {shabbatByDate.get(day) && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold">
                  <Flame className="size-3.5 text-accent" />
                  {shabbatByDate.get(day)!.holiday && <span>{shabbatByDate.get(day)!.holiday}</span>}
                  {!shabbatByDate.get(day)!.restricted && nextDayHoliday(shabbatByDate, day) && (
                    <span>ערב {nextDayHoliday(shabbatByDate, day)}</span>
                  )}
                  {shabbatByDate.get(day)!.candles && (
                    <span>
                      {/* On Shabbat / yom tov itself, the next night's candles are lit after dark from an existing flame. */}
                      {shabbatByDate.get(day)!.restricted
                        ? `הדלקת נרות לא לפני ${shabbatByDate.get(day)!.candles}, מאש קיימת`
                        : `הדלקת נרות ${shabbatByDate.get(day)!.candles}`}
                    </span>
                  )}
                  {shabbatByDate.get(day)!.havdalah && <span>הבדלה {shabbatByDate.get(day)!.havdalah}</span>}
                  {!shabbatByDate.get(day)!.candles && !shabbatByDate.get(day)!.havdalah && <span>שבת / חג</span>}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {(grouped[day] ?? []).map((it) => {
                  const cat = itineraryCategory(it.category);
                  return (
                    <Card key={it.id} className="flex items-start gap-3 p-3">
                      <CardThumbnail
                        imageUrl={it.image_url ?? ambientPhoto(it.category === "food", it.title)}
                        illustrative={!it.image_url && it.category === "food"}
                        alt={it.title}
                        gradient="sunset"
                        size="size-10"
                        rounded="rounded-xl"
                        icon={<span className="text-lg">{cat.emoji}</span>}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {it.start_time && <span className="text-xs font-bold text-primary">{it.start_time.slice(0, 5)}</span>}
                          <span className="truncate font-semibold">{it.title}</span>
                        </div>
                        {it.location && <div className="text-xs text-muted-foreground">📍 {it.location}</div>}
                        {shabbatConflict(shabbatByDate.get(day), it.start_time) && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sun px-2 py-0.5 text-[11px] font-semibold text-sun-foreground">
                            <TriangleAlert className="size-3" />
                            {(shabbatByDate.get(day)!.restricted ? shabbatByDate.get(day)!.holiday : nextDayHoliday(shabbatByDate, day))
                              ? "בחג"
                              : "בשבת"}
                            {shabbatByDate.get(day)!.havdalah ? ` — לפני ההבדלה (${shabbatByDate.get(day)!.havdalah})` : ""}
                          </div>
                        )}
                        {it.description && <p className="mt-0.5 text-sm text-muted-foreground">{it.description}</p>}
                        {it.location && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <MapLink url={resolveMapUrl(it.map_url, it.location, scopeFor(it.category, trip.destination))} />
                            <DirectionsLink place={it.location} near={scopeFor(it.category, trip.destination)} />
                          </div>
                        )}
                      </div>
                      {canEdit && (
                      <div className="flex shrink-0 flex-col gap-1">
                        <button onClick={() => setEditing({ id: it.id, day_date: it.day_date, start_time: it.start_time ?? "", title: it.title, description: it.description ?? "", category: it.category, location: it.location ?? "", image_url: it.image_url ?? null, lat: it.lat ?? null, lng: it.lng ?? null })} className="text-muted-foreground" aria-label="עריכה">
                          <Pencil className="size-4" />
                        </button>
                        <button onClick={() => remove(it.id)} className="text-destructive" aria-label="מחיקה">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      )}
                    </Card>
                  );
                })}
                {canEdit && (
                  <button
                    onClick={() => setEditing({ day_date: day, start_time: "", title: "", description: "", category: "activity", location: "", image_url: null, lat: null, lng: null })}
                    className="flex items-center justify-center gap-1 rounded-2xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground"
                  >
                    <Plus className="size-4" /> הוספה ליום זה
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

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
