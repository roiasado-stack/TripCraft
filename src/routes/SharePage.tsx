import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { Flight, ItineraryItem, Stay, Suggestion, Trip } from "@/lib/types";
import { Card, FullSpinner } from "@/components/ui";
import { TripUpdates } from "@/components/TripUpdates";
import { PhotoAlbumCard } from "@/components/PhotoAlbumCard";
import { GuideCard } from "@/components/GuideCard";
import { MapLink } from "@/components/MapLink";
import { resolveMapUrl } from "@/lib/maps";
import {
  daysBetween,
  formatDateTimeHeb,
  formatDayHeb,
  formatHeb,
  itineraryCategory,
  SUGGESTION_KINDS,
  tripDuration,
} from "@/lib/trip-options";

export default function SharePage() {
  const { slug } = useParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [agency, setAgency] = useState<{ name: string | null; color: string | null } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  useEffect(() => {
    (async () => {
      if (!slug) return;
      const { data: t } = await supabase.from("trips").select("*").eq("share_slug", slug).eq("is_shared", true).maybeSingle();
      if (!t) {
        setState("notfound");
        return;
      }
      const trip = t as Trip;
      setTrip(trip);
      const [f, s, it, sg, prof] = await Promise.all([
        supabase.from("flights").select("*").eq("trip_id", trip.id).order("depart_at"),
        supabase.from("stays").select("*").eq("trip_id", trip.id).order("check_in"),
        supabase.from("itinerary_items").select("*").eq("trip_id", trip.id).order("day_date").order("sort_order"),
        supabase.from("suggestions").select("*").eq("trip_id", trip.id).order("created_at"),
        supabase.from("profiles").select("agency_name, agency_color").eq("id", trip.user_id).maybeSingle(),
      ]);
      setFlights((f.data as Flight[]) ?? []);
      setStays((s.data as Stay[]) ?? []);
      setItinerary((it.data as ItineraryItem[]) ?? []);
      setSuggestions((sg.data as Suggestion[]) ?? []);
      setAgency((prof.data as { agency_name: string | null; agency_color: string | null } | null)
        ? { name: (prof.data as any).agency_name, color: (prof.data as any).agency_color }
        : null);
      setState("ready");
    })();
  }, [slug]);

  if (state === "loading") return <FullSpinner label="טוען טיול…" />;
  if (state === "notfound" || !trip)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="text-lg font-bold">הטיול לא זמין</h1>
        <p className="text-sm text-muted-foreground">ייתכן שהקישור שגוי או שהשיתוף בוטל.</p>
      </div>
    );

  const accent = agency?.color || undefined;
  const duration = tripDuration(trip.start_date, trip.end_date);
  const days = new Set<string>();
  if (trip.start_date && trip.end_date) daysBetween(trip.start_date, trip.end_date).forEach((d) => days.add(d));
  itinerary.forEach((i) => days.add(i.day_date));
  const sortedDays = [...days].sort();

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16">
      {/* agency header */}
      {agency?.name && (
        <div className="mb-4 mt-4 rounded-2xl px-4 py-3 text-center text-sm font-bold text-white shadow-soft" style={{ background: accent ?? "var(--primary)" }}>
          {agency.name}
        </div>
      )}

      {/* hero */}
      <div className="mt-4 overflow-hidden rounded-4xl bg-gradient-sea p-6 text-white shadow-pop" style={accent ? { background: accent } : undefined}>
        <div className="text-4xl">{trip.cover_emoji ?? "🌴"}</div>
        <h1 className="mt-2 text-2xl font-extrabold">{trip.title}</h1>
        <p className="text-white/85">{trip.destination}</p>
        {trip.start_date && (
          <p className="mt-2 text-sm text-white/85">
            {formatHeb(trip.start_date)} – {formatHeb(trip.end_date)} {duration ? `· ${duration} ימים` : ""}
          </p>
        )}
      </div>

      <GuideCard trip={trip} />

      {/* Read-only announcements and the shared album: what a client most
          wants from a link an agent sent them. */}
      <TripUpdates tripId={trip.id} editable={false} />
      <PhotoAlbumCard trip={trip} editable={false} />

      {/* flights */}
      {flights.length > 0 && (
        <Section title="✈️ טיסות">
          {flights.map((f) => (
            <Card key={f.id} className="mb-2 p-3 text-sm">
              <div className="flex items-center justify-between font-semibold">
                <span>{f.from_airport} → {f.to_airport}</span>
                <span className="text-muted-foreground">{f.airline} {f.flight_number}</span>
              </div>
              {f.depart_at && <div className="text-xs text-muted-foreground">{formatDateTimeHeb(f.depart_at)}</div>}
            </Card>
          ))}
        </Section>
      )}

      {/* stays */}
      {stays.length > 0 && (
        <Section title="🏨 לינה">
          {stays.map((s) => (
            <Card key={s.id} className="mb-2 p-3 text-sm">
              <div className="font-semibold">{s.hotel_name}</div>
              {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
              {(s.check_in || s.check_out) && (
                <div className="text-xs text-muted-foreground">{formatHeb(s.check_in)} – {formatHeb(s.check_out)}</div>
              )}
              <div className="mt-1.5">
                <MapLink url={resolveMapUrl(s.map_url, s.address || s.hotel_name, trip.destination)} />
              </div>
            </Card>
          ))}
        </Section>
      )}

      {/* itinerary */}
      {sortedDays.length > 0 && itinerary.length > 0 && (
        <Section title="🗓️ מסלול">
          {sortedDays.map((day, idx) => {
            const dayItems = itinerary.filter((i) => i.day_date === day);
            if (dayItems.length === 0) return null;
            return (
              <div key={day} className="mb-3">
                <div className="mb-1.5 font-bold">יום {idx + 1} · {formatDayHeb(day)}</div>
                {dayItems.map((it) => {
                  const cat = itineraryCategory(it.category);
                  return (
                    <Card key={it.id} className="mb-1.5 flex items-start gap-2 p-2.5 text-sm">
                      <span className="text-lg">{cat.emoji}</span>
                      <div>
                        <div className="font-semibold">
                          {it.start_time && <span className="text-primary">{it.start_time.slice(0, 5)} · </span>}
                          {it.title}
                        </div>
                        {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                        {(it.map_url || it.location) && (
                          <div className="mt-1">
                            <MapLink url={resolveMapUrl(it.map_url, it.location, trip.destination)} />
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </Section>
      )}

      {/* suggestions */}
      {suggestions.length > 0 && (
        <Section title="✨ מומלצים">
          {suggestions.map((s) => {
            const kind = SUGGESTION_KINDS.find((k) => k.value === s.kind);
            return (
              <Card key={s.id} className="mb-2 flex items-start gap-2 p-3 text-sm">
                <span className="text-lg">{kind?.emoji ?? "📍"}</span>
                <div>
                  <div className="font-semibold">{s.title}</div>
                  {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                  {(s.map_url || s.location) && (
                    <div className="mt-1">
                      <MapLink url={resolveMapUrl(s.map_url, s.location ?? s.title, trip.destination)} />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </Section>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        נבנה עם <span className="font-bold">TripCraft</span> 🌴
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}
