import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FileDown, Plane, Wand2 } from "lucide-react";
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
import { agencyPageTitle } from "@/lib/share-og";
import { settleForPrint, shouldAutoPrint } from "@/lib/share-print";
import { AGENCY_LOGO_BUCKET, isAgencyLogoPath, safeAgencyColor } from "@/lib/agency-brand";
import { cn } from "@/lib/utils";
import { resolveMapUrl, stayMapUrl } from "@/lib/maps";
import { sortItinerary } from "@/lib/itinerary-order";
import { LegalLinks } from "@/components/LegalLinks";
import { ShareEnglishContext } from "@/hooks/use-share-english";
import {
  formatDateEn,
  formatDayEn,
  isEnglishShare,
  SHARE_EN,
  SUGGESTION_KINDS_EN,
} from "@/lib/share-english";
import { flightStamp } from "@/lib/flight-display";
import { tripLimitMessage } from "@/lib/trip-quota";
import {
  daysBetween,
  formatDayHeb,
  formatHeb,
  itineraryCategory,
  SUGGESTION_KINDS,
  tripDuration,
} from "@/lib/trip-options";

export default function SharePage() {
  // `?lang=en` shows this page in English for agencies abroad (share-english.ts).
  const en = isEnglishShare(useLocation().search) ? SHARE_EN : null;
  return (
    <ShareEnglishContext.Provider value={en}>
      <div lang={en ? "en" : undefined} dir={en ? "ltr" : undefined}>
        <SharedTrip en={en} />
      </div>
    </ShareEnglishContext.Provider>
  );
}

function SharedTrip({ en }: { en: typeof SHARE_EN | null }) {
  const { slug } = useParams();
  const { search } = useLocation();
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
      // A signed-in private account at its one trip, copying a private user's showcase (029).
      toast.error(tripLimitMessage(e) ?? "לא הצלחנו לפתוח עותק לניסיון. נסו שוב בעוד רגע.");
      setTrying(false);
    }
  };
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  // Toasts and overlays render outside this page's wrapper, so the document
  // itself turns English while the page is open, and back to Hebrew after.
  useEffect(() => {
    if (!en) return;
    const root = document.documentElement;
    root.lang = "en";
    root.dir = "ltr";
    return () => {
      root.lang = "he";
      root.dir = "rtl";
    };
  }, [en]);

  const fmtDate = en ? formatDateEn : formatHeb;

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

  // Tab title. An agency's page names the trip and the agency in both
  // languages, never TripCraft; other pages keep index.html's title, or the
  // English one with ?lang=en once we know the trip isn't an agency's.
  useEffect(() => {
    const next = (shared && agencyPageTitle(shared)) ?? (en && state !== "loading" ? en.pageTitle : null);
    if (!next) return;
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [en, shared, state]);

  // `?print=1` (the agency's "PDF ללקוח"): open the print dialog once, after the
  // trip is on screen and its photos and fonts have settled.
  const printed = useRef(false);
  useEffect(() => {
    if (!shouldAutoPrint({ search, state, printed: printed.current })) return;
    let cancelled = false;
    void settleForPrint().then(() => {
      if (cancelled || printed.current) return;
      printed.current = true;
      window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [search, state]);

  if (state === "loading") return <FullSpinner label={en?.loading ?? "טוען טיול…"} />;
  if (state === "notfound" || !shared)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="type-title">{en?.notFoundTitle ?? "הטיול לא זמין"}</h1>
        <p className="type-footnote text-muted-foreground">{en?.notFoundBody ?? "ייתכן שהקישור שגוי או שהשיתוף בוטל."}</p>
      </div>
    );

  const { trip, agency, flights, stays, suggestions, updates } = shared;
  // The RPC returns day_date, sort_order; the page shows the same order as the app.
  const itinerary = sortItinerary(shared.itinerary);
  // 023 already filters these server-side; checked again because they reach
  // anonymous visitors (a CSS value or foreign URL could load a tracking pixel).
  const accent = safeAgencyColor(agency?.color) ?? undefined;
  const agencyName = agency?.name?.trim() || null;
  // Only a path comes from the server; the URL is always our own project's.
  const logoPath = agency?.logo_path;
  const agencyLogo = isAgencyLogoPath(logoPath)
    ? supabase.storage.from(AGENCY_LOGO_BUCKET).getPublicUrl(logoPath).data.publicUrl
    : null;
  const isAgencyPage = Boolean(agencyName || agencyLogo);
  const duration = tripDuration(trip.start_date, trip.end_date);
  const heroPhoto = isTripPhotoUrl(trip.image_url) ? trip.image_url : null;
  const days = new Set<string>();
  if (trip.start_date && trip.end_date) daysBetween(trip.start_date, trip.end_date).forEach((d) => days.add(d));
  itinerary.forEach((i) => days.add(i.day_date));
  const sortedDays = [...days].sort();

  return (
    // Printed (PDF), the page uses the sheet's full width; print: classes below
    // hide what can't be tapped on paper and keep each card whole on one page.
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 print:min-h-0 print:max-w-none print:px-0 print:pb-0">
      {/* agency header */}
      {/* The agency's own colour is a stripe, never a text background: any
          colour an agent picks keeps the name readable in both modes. */}
      {isAgencyPage && (
        <div
          className="mt-4 flex items-center gap-3 rounded-2xl border-s-4 border-primary bg-card px-4 py-3 text-card-foreground shadow-soft print:mt-0 print:break-inside-avoid"
          style={accent ? { borderInlineStartColor: accent } : undefined}
        >
          {agencyLogo && (
            <img
              src={agencyLogo}
              alt={en?.agencyLogo(agencyName) ?? (agencyName ? `הלוגו של ${agencyName}` : "הלוגו של הסוכנות")}
              className="size-12 shrink-0 rounded-xl object-contain"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="type-footnote text-muted-foreground">{en?.tripBy ?? "הטיול שלכם מאת"}</div>
            {agencyName && (
              <div className="type-headline truncate [unicode-bidi:plaintext]">{agencyName}</div>
            )}
          </div>
        </div>
      )}

      {/* hero */}
      <div
        className={cn(
          "relative mt-4 overflow-hidden rounded-4xl text-white shadow-pop print:break-inside-avoid print:shadow-none",
          heroPhoto ? "flex min-h-72 flex-col justify-end" : "bg-gradient-sea",
        )}
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
            {fmtDate(trip.start_date)}
            {trip.end_date ? ` – ${fmtDate(trip.end_date)}` : ""}{" "}
            {duration ? `· ${en?.days(duration) ?? `${duration} ימים`}` : ""}
          </p>
        )}
        </div>
      </div>

      {/* The client can save the brochure too; the browser's dialog has "Save as PDF". */}
      <div className="mt-3 flex justify-end print:hidden">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <FileDown className="size-4" aria-hidden />
          {en?.savePdf ?? "שמירה כ-PDF"}
        </Button>
      </div>

      {/* "Try it yourself" opens the full app, which is Hebrew only. */}
      {trip.is_showcase && !en && (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-card p-5 text-center text-card-foreground print:hidden">
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
        <Section title={en?.flights ?? "טיסות"}>
          <GroupedList>
            {flights.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3 print:break-inside-avoid">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Plane className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Route reads left-to-right like a boarding pass. */}
                  <div dir="ltr" className={cn("type-headline truncate", en ? "text-start" : "text-end")}>
                    <bdi>{f.from_airport || "—"}</bdi> → <bdi>{f.to_airport || "—"}</bdi>
                  </div>
                  {/* The ticket's wall clock at each airport — never the visitor's zone. */}
                  {(f.depart_at || f.depart_local) && (
                    <div className="type-footnote text-muted-foreground">
                      {en?.departs ?? "המראה"} <bdi className="tabular-nums">{flightStamp(f.depart_local, f.depart_at, en ? "en" : "he")}</bdi>
                      {(f.arrive_at || f.arrive_local) && (
                        <>
                          {" · "}
                          {en?.lands ?? "נחיתה"} <bdi className="tabular-nums">{flightStamp(f.arrive_local, f.arrive_at, en ? "en" : "he")}</bdi>
                        </>
                      )}
                    </div>
                  )}
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
        <Section title={en?.stays ?? "לינה"}>
          <GroupedList>
            {stays.map((st) => (
              <div key={st.id} className="flex items-start gap-3 px-4 py-3 print:break-inside-avoid">
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
                      {[st.check_in, st.check_out].filter(Boolean).map((d) => fmtDate(d)).join(" – ")}
                    </div>
                  )}
                </div>
                <MapLink url={stayMapUrl(st, trip.destination)} className="print:hidden" />
              </div>
            ))}
          </GroupedList>
        </Section>
      )}

      {/* itinerary */}
      {sortedDays.length > 0 && itinerary.length > 0 && (
        <Section title={en?.itinerary ?? "מסלול"}>
          <div className="flex flex-col gap-5">
            {sortedDays.map((day, idx) => {
              const dayItems = itinerary.filter((i) => i.day_date === day);
              if (dayItems.length === 0) return null;
              return (
                <div key={day} className="print:break-inside-avoid">
                  <div className="mb-1.5 flex items-baseline gap-2 px-1">
                    <span className="type-footnote font-semibold text-primary">{en?.day(idx + 1) ?? `יום ${idx + 1}`}</span>
                    <h3 className="type-headline">{(en ? formatDayEn : formatDayHeb)(day)}</h3>
                  </div>
                  <GroupedList>
                    {dayItems.map((it) => {
                      const cat = itineraryCategory(it.category);
                      return (
                        <div key={it.id} className="flex items-start gap-3 px-4 py-3 print:break-inside-avoid">
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
                            <MapLink url={resolveMapUrl(it.map_url, it.location, trip.destination)} className="print:hidden" />
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
        <Section title={en?.suggestions ?? "מומלצים"}>
          <GroupedList>
            {suggestions.map((sg) => {
              const kind = SUGGESTION_KINDS.find((k) => k.value === sg.kind);
              return (
                <div key={sg.id} className="flex items-start gap-3 px-4 py-3 print:break-inside-avoid">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-lg" aria-hidden>
                    {kind?.emoji ?? "📍"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="type-headline [overflow-wrap:anywhere]">
                      <bdi>{sg.title}</bdi>
                    </div>
                    {kind && <div className="type-footnote text-muted-foreground">{en ? SUGGESTION_KINDS_EN[kind.value] : kind.label}</div>}
                    {sg.description && (
                      <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{sg.description}</p>
                    )}
                  </div>
                  {(sg.map_url || sg.location) && (
                    <MapLink url={resolveMapUrl(sg.map_url, sg.location ?? sg.title, trip.destination)} className="print:hidden" />
                  )}
                </div>
              );
            })}
          </GroupedList>
        </Section>
      )}

      {/* An agent's page carries only the agency's brand: no TripCraft credit. */}
      {!isAgencyPage && (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {en?.builtWith ?? "נבנה עם"} <span className="font-bold">TripCraft</span> 🌴
        </p>
      )}
      <LegalLinks className={cn(isAgencyPage ? "mt-8" : "mt-2", "print:hidden")} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="type-title mb-2 px-1 print:break-after-avoid">{title}</h2>
      {children}
    </section>
  );
}
