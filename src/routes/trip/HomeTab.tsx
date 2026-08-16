import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, CopyPlus, Plane, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Flight, ItineraryItem, Stay } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader } from "@/components/TripHeader";
import { Button, Card, Spinner } from "@/components/ui";
import {
  daysUntil,
  formatDateTimeHeb,
  formatDayHeb,
  formatHeb,
  itineraryCategory,
  tripDuration,
} from "@/lib/trip-options";

export default function HomeTab() {
  const { trip, participants, openShare } = useTrip();
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
      const todayStr = new Date().toISOString().slice(0, 10);
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

  const until = daysUntil(trip.start_date);
  const endUntil = daysUntil(trip.end_date);
  const ongoing = until !== null && until <= 0 && endUntil !== null && endUntil >= 0;
  const duration = tripDuration(trip.start_date, trip.end_date);

  const nextFlight = flights.find((f) => !f.depart_at || new Date(f.depart_at) >= new Date()) ?? flights[0];

  return (
    <div className="px-4">
      <TripHeader trip={trip} onShare={openShare} />

      {/* Countdown hero */}
      <div className="relative overflow-hidden rounded-4xl bg-gradient-sea p-6 text-white shadow-pop">
        <div className="pointer-events-none absolute -top-8 -left-8 size-32 rounded-full bg-white/15 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-white/85">{trip.destination}</p>
          {ongoing ? (
            <>
              <div className="mt-1 text-4xl font-extrabold">בטיול! 🌊</div>
              <p className="mt-1 text-white/85">
                {endUntil === 0 ? "היום היום האחרון" : `עוד ${endUntil} ימים של כיף`}
              </p>
            </>
          ) : until !== null && until > 0 ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-extrabold">{until}</span>
                <span className="text-xl font-bold">ימים</span>
              </div>
              <p className="mt-1 text-white/85">
                עד היציאה · {formatHeb(trip.start_date)}
                {duration ? ` · ${duration} ימים` : ""}
              </p>
            </>
          ) : (
            <>
              <div className="mt-1 text-3xl font-extrabold">הטיול הסתיים 💛</div>
              <p className="mt-1 text-white/85">מקווים שנהניתם!</p>
            </>
          )}
        </div>
      </div>

      {/* quick stats */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Link to="people">
          <Stat icon={<Users className="size-5" />} value={participants.length} label="משתתפים" actionable />
        </Link>
        <Stat icon={<Plane className="size-5" />} value={flights.length} label="טיסות" />
        <Stat icon={<CalendarDays className="size-5" />} value={duration ?? "—"} label="ימים" />
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Next flight */}
          {nextFlight && (
            <Card className="mt-4 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary">
                <Plane className="size-4" />
                {nextFlight.direction === "inbound" ? "טיסת חזור" : "הטיסה הקרובה"}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-center">
                  <div className="text-xl font-extrabold">{nextFlight.from_airport || "—"}</div>
                  <div className="text-xs text-muted-foreground">מוצא</div>
                </div>
                <div className="flex flex-1 flex-col items-center px-2">
                  <Plane className="size-4 -scale-x-100 text-muted-foreground" />
                  <div className="my-1 h-px w-full bg-border" />
                  <div className="text-xs font-medium text-muted-foreground">
                    {nextFlight.airline} {nextFlight.flight_number}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-extrabold">{nextFlight.to_airport || "—"}</div>
                  <div className="text-xs text-muted-foreground">יעד</div>
                </div>
              </div>
              {nextFlight.depart_at && (
                <div className="mt-3 rounded-2xl bg-muted px-3 py-2 text-center text-sm font-semibold">
                  {formatDateTimeHeb(nextFlight.depart_at)}
                </div>
              )}
            </Card>
          )}

          {/* Today */}
          {ongoing && (
            <div className="mt-4">
              <h3 className="mb-2 font-bold">מה קורה היום · {formatDayHeb(new Date().toISOString().slice(0, 10))}</h3>
              {today.length === 0 ? (
                <Card className="p-4 text-center text-sm text-muted-foreground">
                  אין עדיין תוכניות להיום.{" "}
                  <Link to="itinerary" className="font-semibold text-primary">
                    הוסף למסלול
                  </Link>
                </Card>
              ) : (
                <div className="flex flex-col gap-2">
                  {today.map((it) => {
                    const cat = itineraryCategory(it.category);
                    return (
                      <Card key={it.id} className="flex items-center gap-3 p-3">
                        <div className="grid size-10 place-items-center rounded-xl bg-primary-soft text-lg">{cat.emoji}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{it.title}</div>
                          {it.start_time && <div className="text-xs text-muted-foreground">{it.start_time.slice(0, 5)}</div>}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Duplicate as a new trip */}
          <Button variant="outline" size="lg" className="mt-4 w-full" loading={duplicating} onClick={duplicate}>
            <CopyPlus className="size-5" />
            שכפול הטיול כתבנית חדשה
          </Button>

          {/* Stays summary */}
          {stays.length > 0 && (
            <Card className="mt-4 p-4">
              <div className="mb-1 text-sm font-bold text-primary">🏨 לינה</div>
              {stays.map((s) => (
                <div key={s.id} className="border-b border-border py-2 last:border-0">
                  <div className="font-semibold">{s.hotel_name}</div>
                  {(s.check_in || s.check_out) && (
                    <div className="text-xs text-muted-foreground">
                      {formatHeb(s.check_in)} – {formatHeb(s.check_out)}
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
  actionable,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  actionable?: boolean;
}) {
  return (
    <Card
      className={`flex h-full flex-col items-center gap-1 p-3 ${actionable ? "border-primary/40 transition active:scale-[0.98]" : ""}`}
    >
      <div className="text-primary">{icon}</div>
      <div className="text-xl font-extrabold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground">
        {label}
        {actionable && " ›"}
      </div>
    </Card>
  );
}
