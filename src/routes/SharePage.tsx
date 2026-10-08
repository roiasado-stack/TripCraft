import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { SharedTripPayload } from "@/lib/types";
import { Button, Card, FullSpinner } from "@/components/ui";
import { TripUpdates } from "@/components/TripUpdates";
import { PhotoAlbumCard } from "@/components/PhotoAlbumCard";
import { GuideCard } from "@/components/GuideCard";
import { MapLink } from "@/components/MapLink";
import { Flag } from "@/components/Flag";
import { ImageCredit } from "@/components/MediaCard";
import { isTripPhotoUrl } from "@/lib/photo-url";
import { cn } from "@/lib/utils";
import { resolveMapUrl } from "@/lib/maps";
import { LegalLinks } from "@/routes/LegalPages";
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
  const [shared, setShared] = useState<SharedTripPayload | null>(null);
  const [trying, setTrying] = useState(false);
  const { session } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // "Try it yourself" (migration 016): a signed-out visitor gets an anonymous
  // session, then a personal copy of this showcase to edit. A second click
  // returns the same copy.
  const tryIt = async () => {
    if (!slug) return;
    setTrying(true);
    try {
      if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data, error } = await supabase.rpc("clone_showcase_trip", { p_slug: slug });
      if (error || !data) throw error ?? new Error("no_trip");
      navigate(`/trip/${data as string}`);
    } catch (e) {
      console.error(e);
      toast.error("לא הצלחנו לפתוח עותק לניסיון. נסו שוב בעוד רגע.");
      setTrying(false);
    }
  };
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  useEffect(() => {
    (async () => {
      if (!slug) return;
      // One slug-gated RPC (migration 013): anonymous visitors have no table
      // access, so the trip can't be listed without its link.
      const { data } = await supabase.rpc("get_shared_trip", { p_slug: slug });
      if (!data) {
        setState("notfound");
        return;
      }
      setShared(data as SharedTripPayload);
      setState("ready");
    })();
  }, [slug]);

  if (state === "loading") return <FullSpinner label="טוען טיול…" />;
  if (state === "notfound" || !shared)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="text-lg font-bold">הטיול לא זמין</h1>
        <p className="text-sm text-muted-foreground">ייתכן שהקישור שגוי או שהשיתוף בוטל.</p>
      </div>
    );

  const { trip, agency, flights, stays, itinerary, suggestions, updates } = shared;
  const accent = agency?.color || undefined;
  const duration = tripDuration(trip.start_date, trip.end_date);
  const heroPhoto = isTripPhotoUrl(trip.image_url) ? trip.image_url : null;
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
      <div
        className={cn(
          "relative mt-4 overflow-hidden rounded-4xl text-white shadow-pop",
          heroPhoto ? "flex min-h-72 flex-col justify-end" : "bg-gradient-sea",
        )}
        style={!heroPhoto && accent ? { background: accent } : undefined}
      >
        {heroPhoto && (
          <>
            <img src={heroPhoto} alt={trip.destination} className="absolute inset-0 size-full object-cover" />
            <div className="hero-scrim pointer-events-none absolute inset-0" />
            <ImageCredit imageUrl={heroPhoto} />
          </>
        )}
        <div className="relative p-6">
        <div className="text-4xl">
          <Flag destination={trip.destination} fallback={trip.cover_emoji} className="w-12" />
        </div>
        <h1 className="mt-2 text-2xl font-extrabold">{trip.title}</h1>
        <p className="font-medium text-white">{trip.destination}</p>
        {trip.start_date && (
          <p className="mt-2 text-sm font-medium text-white">
            {formatHeb(trip.start_date)} – {formatHeb(trip.end_date)} {duration ? `· ${duration} ימים` : ""}
          </p>
        )}
        </div>
      </div>

      {trip.is_showcase && (
        <Card className="mt-4 flex flex-col gap-2 p-4 text-center">
          <div className="font-bold">רוצים לנסות בעצמכם?</div>
          <p className="text-sm text-muted-foreground">
            קבלו עותק אישי של הטיול הזה, שנו מה שבא לכם ונסו את הסוכן החכם. בלי הרשמה.
          </p>
          <Button size="lg" variant="accent" loading={trying} onClick={tryIt}>
            <Wand2 className="size-5" />
            נסו בעצמכם
          </Button>
        </Card>
      )}

      <GuideCard trip={trip} />

      {/* Read-only announcements and the shared album: what a client most
          wants from a link an agent sent them. */}
      <TripUpdates tripId={trip.id} editable={false} preloaded={updates} />
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
      <LegalLinks className="mt-2" />
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
