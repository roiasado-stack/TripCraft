import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plane, Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { SharedTripPayload } from "@/lib/types";
import { Button, FullSpinner, GroupedList } from "@/components/ui";
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
        <h1 className="type-title">הטיול לא זמין</h1>
        <p className="type-footnote text-muted-foreground">ייתכן שהקישור שגוי או שהשיתוף בוטל.</p>
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
        <h1 className="type-title mt-2 [overflow-wrap:anywhere]">
          <bdi>{trip.title}</bdi>
        </h1>
        <p className="type-headline mt-0.5 text-white">
          <bdi>{trip.destination}</bdi>
        </p>
        {trip.start_date && (
          <p className="type-footnote mt-2 font-semibold text-white">
            {formatHeb(trip.start_date)}
            {trip.end_date ? ` – ${formatHeb(trip.end_date)}` : ""} {duration ? `· ${duration} ימים` : ""}
          </p>
        )}
        </div>
      </div>

      {trip.is_showcase && (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-card p-5 text-center text-card-foreground">
          <div className="type-headline">רוצים לנסות בעצמכם?</div>
          <p className="type-footnote text-muted-foreground">
            קבלו עותק אישי של הטיול הזה, שנו מה שבא לכם ונסו את הסוכן החכם. בלי הרשמה.
          </p>
          <Button size="lg" variant="accent" loading={trying} onClick={tryIt}>
            <Wand2 className="size-5" />
            נסו בעצמכם
          </Button>
        </div>
      )}

      <GuideCard trip={trip} />

      {/* Read-only announcements and the shared album: what a client most
          wants from a link an agent sent them. */}
      <TripUpdates tripId={trip.id} editable={false} preloaded={updates} />
      <PhotoAlbumCard trip={trip} editable={false} />

      {/* flights */}
      {flights.length > 0 && (
        <Section title="טיסות">
          <GroupedList>
            {flights.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Plane className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Route reads left-to-right like a boarding pass. */}
                  <div dir="ltr" className="type-headline truncate text-end">
                    <bdi>{f.from_airport || "—"}</bdi> → <bdi>{f.to_airport || "—"}</bdi>
                  </div>
                  {f.depart_at && <div className="type-footnote text-muted-foreground">{formatDateTimeHeb(f.depart_at)}</div>}
                </div>
                {(f.airline || f.flight_number) && (
                  <span dir="auto" className="type-footnote max-w-[40%] shrink-0 truncate text-muted-foreground">
                    {[f.airline, f.flight_number].filter(Boolean).join(" ")}
                  </span>
                )}
              </div>
            ))}
          </GroupedList>
        </Section>
      )}

      {/* stays */}
      {stays.length > 0 && (
        <Section title="לינה">
          <GroupedList>
            {stays.map((st) => (
              <div key={st.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="type-headline [overflow-wrap:anywhere]">
                    <bdi>{st.hotel_name}</bdi>
                  </div>
                  {st.address && (
                    <div className="type-footnote text-muted-foreground [overflow-wrap:anywhere]">
                      <bdi>{st.address}</bdi>
                    </div>
                  )}
                  {(st.check_in || st.check_out) && (
                    <div className="type-footnote text-muted-foreground">
                      {[st.check_in, st.check_out].filter(Boolean).map((d) => formatHeb(d)).join(" – ")}
                    </div>
                  )}
                </div>
                <MapLink url={resolveMapUrl(st.map_url, st.address || st.hotel_name, trip.destination)} />
              </div>
            ))}
          </GroupedList>
        </Section>
      )}

      {/* itinerary */}
      {sortedDays.length > 0 && itinerary.length > 0 && (
        <Section title="מסלול">
          <div className="flex flex-col gap-5">
            {sortedDays.map((day, idx) => {
              const dayItems = itinerary.filter((i) => i.day_date === day);
              if (dayItems.length === 0) return null;
              return (
                <div key={day}>
                  <div className="mb-1.5 flex items-baseline gap-2 px-1">
                    <span className="type-footnote font-semibold text-primary">יום {idx + 1}</span>
                    <h3 className="type-headline">{formatDayHeb(day)}</h3>
                  </div>
                  <GroupedList>
                    {dayItems.map((it) => {
                      const cat = itineraryCategory(it.category);
                      return (
                        <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-lg" aria-hidden>
                            {cat.emoji}
                          </span>
                          <div className="min-w-0 flex-1">
                            {it.start_time && (
                              <div className="type-footnote font-semibold tabular-nums text-primary">{it.start_time.slice(0, 5)}</div>
                            )}
                            <div className="type-headline [overflow-wrap:anywhere]">
                              <bdi>{it.title}</bdi>
                            </div>
                            {it.description && (
                              <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{it.description}</p>
                            )}
                          </div>
                          {(it.map_url || it.location) && (
                            <MapLink url={resolveMapUrl(it.map_url, it.location, trip.destination)} />
                          )}
                        </div>
                      );
                    })}
                  </GroupedList>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* suggestions */}
      {suggestions.length > 0 && (
        <Section title="מומלצים">
          <GroupedList>
            {suggestions.map((sg) => {
              const kind = SUGGESTION_KINDS.find((k) => k.value === sg.kind);
              return (
                <div key={sg.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-lg" aria-hidden>
                    {kind?.emoji ?? "📍"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="type-headline [overflow-wrap:anywhere]">
                      <bdi>{sg.title}</bdi>
                    </div>
                    {kind && <div className="type-footnote text-muted-foreground">{kind.label}</div>}
                    {sg.description && (
                      <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{sg.description}</p>
                    )}
                  </div>
                  {(sg.map_url || sg.location) && (
                    <MapLink url={resolveMapUrl(sg.map_url, sg.location ?? sg.title, trip.destination)} />
                  )}
                </div>
              );
            })}
          </GroupedList>
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
    <section className="mt-8">
      <h2 className="type-title mb-2 px-1">{title}</h2>
      {children}
    </section>
  );
}
