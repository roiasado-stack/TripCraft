import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CopyPlus, Plane, Sparkles, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Flight, ItineraryItem, Stay } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { TripUpdates } from "@/components/TripUpdates";
import { PhotoAlbumCard } from "@/components/PhotoAlbumCard";
import { GuideCard } from "@/components/GuideCard";
import { GroupedList, ListRow, Spinner } from "@/components/ui";
import { formatDateTimeHeb, itineraryCategory } from "@/lib/trip-options";
import {
  countdownLabel,
  dateRangeHeb,
  dayCount,
  daysFrom,
  localDateString,
  tripLength,
  tripPhase,
} from "@/lib/trip-dates";
import { cn } from "@/lib/utils";

export default function HomeTab() {
  const { trip, role, participants, openShare } = useTrip();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [today, setToday] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [duplicating, setDuplicating] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  /** Deep-copies the trip and its child rows into a brand-new trip. */
  const duplicate = async () => {
    if (!user) return;
    setDuplicating(true);
    try {
      const { data: created, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: `${trip.title} (עותק)`,
          destination: trip.destination,
          start_date: trip.start_date,
          end_date: trip.end_date,
          trip_type: trip.trip_type,
          budget_level: trip.budget_level,
          notes: trip.notes,
          cover_emoji: trip.cover_emoji,
        })
        .select()
        .single();
      if (error || !created) throw error;
      const newId = (created as { id: string }).id;

      // Copy participants first so checklist/document links can be remapped.
      const { data: srcParts } = await supabase.from("participants").select("*").eq("trip_id", trip.id);
      const partMap = new Map<string, string>();
      for (const p of ((srcParts as Record<string, unknown>[]) ?? [])) {
        const { data: np } = await supabase
          .from("participants")
          .insert({
            trip_id: newId,
            name: p.name,
            age: p.age,
            age_range: p.age_range,
            preferences: p.preferences,
            notes: p.notes,
          })
          .select()
          .single();
        if (np) partMap.set(p.id as string, (np as { id: string }).id);
      }

      const copyTable = async (table: string, strip: string[] = []) => {
        const { data: rows } = await supabase.from(table).select("*").eq("trip_id", trip.id);
        const list = (rows as Record<string, unknown>[]) ?? [];
        if (!list.length) return;
        const mapped = list.map((r) => {
          const copy: Record<string, unknown> = { ...r, trip_id: newId };
          delete copy.id;
          delete copy.created_at;
          // Authorship belongs to whoever makes the copy (the column defaults to
          // auth.uid(); RLS rejects anyone else's id — migration 015).
          delete copy.created_by;
          strip.forEach((k) => delete copy[k]);
          if (copy.participant_id) copy.participant_id = partMap.get(copy.participant_id as string) ?? null;
          return copy;
        });
        await supabase.from(table).insert(mapped);
      };

      await Promise.all([
        copyTable("flights"),
        copyTable("stays"),
        copyTable("transfers"),
        copyTable("itinerary_items"),
        copyTable("suggestions", ["liked"]),
        copyTable("checklist_items", ["is_done"]),
      ]);

      toast.success("הטיול שוכפל 🎉");
      navigate(`/trip/${newId}`);
    } catch (e) {
      console.error(e);
      toast.error("השכפול נכשל. נסה שוב.");
    } finally {
      setDuplicating(false);
    }
  };

  useEffect(() => {
    (async () => {
      // The traveller's own day — UTC's date is still yesterday at 6am in Bangkok.
      const todayStr = localDateString(new Date());
      const [f, s, it] = await Promise.all([
        supabase.from("flights").select("*").eq("trip_id", trip.id).order("depart_at"),
        supabase.from("stays").select("*").eq("trip_id", trip.id).order("check_in"),
        supabase.from("itinerary_items").select("*").eq("trip_id", trip.id).eq("day_date", todayStr).order("sort_order"),
      ]);
      setFlights((f.data as Flight[]) ?? []);
      setStays((s.data as Stay[]) ?? []);
      setToday((it.data as ItineraryItem[]) ?? []);
      setLoading(false);
    })();
  }, [trip.id]);

  const now = new Date();
  const phase = tripPhase(trip, now);
  const toStart = daysFrom(trip.start_date, now);
  const toEnd = daysFrom(trip.end_date ?? trip.start_date, now);
  const length = tripLength(trip.start_date, trip.end_date);
  const range = dateRangeHeb(trip.start_date, trip.end_date, now);

  let headline: string;
  let detail: string;
  if (toStart === null) {
    headline = "התאריכים עוד פתוחים";
    detail = "בינתיים אפשר לבנות מסלול ולאסוף המלצות";
  } else if (phase === "upcoming") {
    headline = toStart === 1 ? "מחר יוצאים" : countdownLabel(toStart);
    detail = [range, length ? dayCount(length) : null].filter(Boolean).join(" · ");
  } else if (phase === "now") {
    const day = 1 - toStart;
    headline = length ? `יום ${day} מתוך ${length}` : `יום ${day} בטיול`;
    // Without an end date we don't know when it ends — say nothing rather than guess.
    detail = !trip.end_date
      ? ""
      : toEnd === 0
        ? "היום היום האחרון"
        : toEnd === 1
          ? "מחר היום האחרון"
          : `עוד ${dayCount(toEnd ?? 0)}`;
  } else {
    headline = "הטיול הסתיים";
    detail = range;
  }

  // Only a flight still ahead counts — after the trip there is no "next" one.
  const nextFlight = flights.find((f) => !f.depart_at || new Date(f.depart_at) >= new Date());
  const travelSummary = loading
    ? undefined
    : [
        flights.length ? (flights.length === 1 ? "טיסה אחת" : `${flights.length} טיסות`) : null,
        stays.length ? (stays.length === 1 ? "מלון אחד" : `${stays.length} מלונות`) : null,
      ]
        .filter(Boolean)
        .join(" · ") || "עוד לא הוזנו";

  return (
    <div className="px-4">
      <TripHeader trip={trip} onShare={openShare} />

      {/* Hero: where and when, in one calm statement */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-sea px-5 py-6 text-white">
        <div className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <p className="type-footnote font-semibold text-white/80 [overflow-wrap:anywhere]">{trip.destination}</p>
          <h2 className="type-large-title mt-1">{headline}</h2>
          {detail && <p className="type-body mt-1 text-white/85">{detail}</p>}
        </div>
      </section>

      {/* Today — only while the trip is on */}
      {phase === "now" && !loading && (
        <GroupedList
          className="mt-6"
          title={`היום · ${now.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}`}
        >
          {today.length === 0 ? (
            <ListRow to="itinerary" title="אין עדיין תוכניות להיום" subtitle="הוספה למסלול" />
          ) : (
            today.map((it) => (
              <ListRow
                key={it.id}
                to="itinerary"
                leading={
                  <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-lg">
                    {itineraryCategory(it.category).emoji}
                  </span>
                }
                title={it.title}
                subtitle={it.start_time ? it.start_time.slice(0, 5) : undefined}
              />
            ))
          )}
        </GroupedList>
      )}

      <TripUpdates tripId={trip.id} role={role} className="mt-6" />

      <GroupedList className="mt-6">
        <ListRow
          to="people"
          leading={<IconTile icon={<Users className="size-[18px]" />} />}
          title="משתתפים"
          trailing={<span className="type-body tabular-nums">{participants.length}</span>}
        />
        <ListRow
          to="transport"
          leading={<IconTile icon={<Plane className="size-[18px]" />} />}
          title="טיסות ולינה"
          subtitle={travelSummary}
        />
        <ListRow
          to="ask"
          leading={<IconTile icon={<Sparkles className="size-[18px]" />} tone="accent" />}
          title="שאל את הסוכן"
          subtitle="שאלות והמלצות בהתאמה לטיול שלך"
        />
      </GroupedList>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        nextFlight && (
          <GroupedList className="mt-6" title={nextFlight.direction === "inbound" ? "טיסת חזור" : "הטיסה הקרובה"}>
            <ListRow
              to="transport"
              leading={<IconTile icon={<Plane className="size-[18px]" />} />}
              // Flights read left-to-right everywhere (TLV → FCO), Hebrew names included.
              title={
                // Each airport isolated, so a Hebrew name keeps its own word order.
                <span dir="ltr">
                  <bdi>{nextFlight.from_airport || "—"}</bdi> → <bdi>{nextFlight.to_airport || "—"}</bdi>
                </span>
              }
              subtitle={
                [
                  [nextFlight.airline, nextFlight.flight_number].filter(Boolean).join(" "),
                  formatDateTimeHeb(nextFlight.depart_at),
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
          </GroupedList>
        )
      )}

      <GuideCard trip={trip} className="mt-6" />

      <PhotoAlbumCard trip={trip} editable={can(role, "edit")} className="mt-6" />

      {!loading && stays.length > 0 && (
        <GroupedList className="mt-6" title="לינה">
          {stays.map((s) => (
            <ListRow
              key={s.id}
              to="transport"
              title={s.hotel_name}
              subtitle={dateRangeHeb(s.check_in, s.check_out, now) || undefined}
            />
          ))}
        </GroupedList>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl bg-card">
        <button
          type="button"
          onClick={duplicate}
          disabled={duplicating}
          className="type-headline flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start text-primary transition-colors active:bg-muted/70 disabled:opacity-60"
        >
          {duplicating ? <Spinner className="size-5" /> : <CopyPlus className="size-5" />}
          שכפול הטיול כתבנית חדשה
        </button>
      </div>
    </div>
  );
}

/** iOS Settings-style rounded square behind a row's icon. */
function IconTile({ icon, tone = "primary" }: { icon: React.ReactNode; tone?: "primary" | "accent" }) {
  return (
    <span
      className={cn(
        "grid size-8 place-items-center rounded-[9px]",
        tone === "accent" ? "bg-tile-accent text-tile-accent-foreground" : "bg-tile text-tile-foreground",
      )}
    >
      {icon}
    </span>
  );
}
