import { useEffect, useState } from "react";
import { Car, CircleAlert, Luggage, Phone, Plane, Radar, Ticket } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Flight, Stay, Transfer } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Card, FullSpinner } from "@/components/ui";
import { DirectionsLink, LinkChip, MapLink } from "@/components/MapLink";
import {
  airportMapUrl,
  carRentalSearchUrl,
  flightStatusUrl,
  resolveMapUrl,
  taxiSearchUrl,
} from "@/lib/maps";
import { formatDateTimeHeb, formatHeb, formatTimeHeb } from "@/lib/trip-options";

/** Minutes between two ISO timestamps, as "5ש 20ד". */
function duration(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}ש${m ? ` ${m}ד` : ""}` : `${m}ד`;
}

export default function TransportTab() {
  const { trip } = useTrip();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [f, s, t] = await Promise.all([
        supabase.from("flights").select("*").eq("trip_id", trip.id).order("depart_at"),
        supabase.from("stays").select("*").eq("trip_id", trip.id).order("check_in"),
        supabase.from("transfers").select("*").eq("trip_id", trip.id).order("pickup_at"),
      ]);
      setFlights((f.data as Flight[]) ?? []);
      setStays((s.data as Stay[]) ?? []);
      setTransfers((t.data as Transfer[]) ?? []);
      setLoading(false);
    })();
  }, [trip.id]);

  if (loading) return <FullSpinner />;

  const arrivalAirport = flights.find((f) => f.direction === "outbound")?.to_airport ?? null;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="טיסות, לינה ותחבורה" />
      <ScreenTitle title="נסיעה" />

      {/* Flights */}
      <section className="mb-6">
        <h3 className="mb-2 font-bold">✈️ טיסות</h3>
        {flights.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">לא הוזנו טיסות.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {flights.map((f) => (
              <Card key={f.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-secondary-foreground">
                    {f.direction === "inbound" ? "חזור" : "הלוך"}
                  </span>
                  <span className="text-sm font-bold">
                    {f.airline} {f.flight_number}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="text-center">
                    <div className="text-2xl font-extrabold">{f.from_airport || "—"}</div>
                    <div className="text-xs font-semibold">{formatTimeHeb(f.depart_at)}</div>
                    <div className="text-[11px] text-muted-foreground">{formatHeb(f.depart_at)}</div>
                    {f.from_terminal && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">טרמינל {f.from_terminal}</div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col items-center pt-2">
                    <Plane className="size-4 -scale-x-100 text-muted-foreground" />
                    <div className="my-1 h-px w-full bg-border" />
                    {duration(f.depart_at, f.arrive_at) && (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {duration(f.depart_at, f.arrive_at)}
                      </span>
                    )}
                  </div>

                  <div className="text-center">
                    <div className="text-2xl font-extrabold">{f.to_airport || "—"}</div>
                    <div className="text-xs font-semibold">{formatTimeHeb(f.arrive_at)}</div>
                    <div className="text-[11px] text-muted-foreground">{formatHeb(f.arrive_at)}</div>
                    {f.to_terminal && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">טרמינל {f.to_terminal}</div>
                    )}
                  </div>
                </div>

                {(f.booking_ref || f.seats || f.baggage) && (
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-xs">
                    {f.booking_ref && (
                      <div>
                        <Ticket className="mx-auto size-4 text-muted-foreground" />
                        <div className="mt-0.5 font-bold">{f.booking_ref}</div>
                        <div className="text-[10px] text-muted-foreground">אסמכתה</div>
                      </div>
                    )}
                    {f.seats && (
                      <div>
                        <div className="mx-auto text-sm">💺</div>
                        <div className="mt-0.5 font-bold">{f.seats}</div>
                        <div className="text-[10px] text-muted-foreground">מושבים</div>
                      </div>
                    )}
                    {f.baggage && (
                      <div>
                        <Luggage className="mx-auto size-4 text-muted-foreground" />
                        <div className="mt-0.5 font-bold">{f.baggage}</div>
                        <div className="text-[10px] text-muted-foreground">כבודה</div>
                      </div>
                    )}
                  </div>
                )}

                {f.notes && <p className="mt-2 text-xs text-muted-foreground">{f.notes}</p>}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <LinkChip
                    url={flightStatusUrl(f.airline, f.flight_number)}
                    label="סטטוס טיסה"
                    icon={<Radar className="size-3.5" />}
                  />
                  <MapLink url={airportMapUrl(f.from_airport)} label={`שדה ${f.from_airport ?? ""}`} />
                  <MapLink url={airportMapUrl(f.to_airport)} label={`שדה ${f.to_airport ?? ""}`} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Stays */}
      <section className="mb-6">
        <h3 className="mb-2 font-bold">🏨 לינה</h3>
        {stays.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">לא הוזנה לינה.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {stays.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="font-bold">{s.hotel_name}</div>
                {s.address && <div className="text-sm text-muted-foreground">{s.address}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  צ'ק אין {formatHeb(s.check_in)} · צ'ק אאוט {formatHeb(s.check_out)}
                </div>
                {s.booking_ref && (
                  <div className="mt-1 text-xs">
                    אסמכתה: <span className="font-bold">{s.booking_ref}</span>
                  </div>
                )}
                {s.notes && <p className="mt-1 text-xs text-muted-foreground">{s.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <MapLink url={resolveMapUrl(s.map_url, s.address || s.hotel_name, trip.destination)} />
                  <DirectionsLink place={s.address || s.hotel_name} near={trip.destination} />
                  {s.phone && (
                    <a
                      href={`tel:${s.phone}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold"
                    >
                      <Phone className="size-3.5" /> {s.phone}
                    </a>
                  )}
                  <LinkChip url={s.url} label="אתר המלון" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Transfers & car */}
      <section className="mb-6">
        <h3 className="mb-2 font-bold">🚗 העברות ורכב</h3>
        {transfers.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">לא הוזנו העברות.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {transfers.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-center gap-2">
                  <Car className="size-4 text-primary" />
                  <span className="font-bold">{t.kind === "car_rental" ? "רכב שכור" : "העברה"}</span>
                  {t.provider && <span className="text-sm text-muted-foreground">· {t.provider}</span>}
                </div>
                {t.pickup_location && (
                  <div className="mt-1 text-sm">
                    איסוף: {t.pickup_location}
                    {t.pickup_at && ` · ${formatDateTimeHeb(t.pickup_at)}`}
                  </div>
                )}
                {t.dropoff_location && <div className="text-sm">החזרה: {t.dropoff_location}</div>}
                {t.return_at && (
                  <div className="text-xs text-muted-foreground">מועד החזרה: {formatDateTimeHeb(t.return_at)}</div>
                )}
                {t.booking_ref && (
                  <div className="mt-1 text-xs">
                    אסמכתה: <span className="font-bold">{t.booking_ref}</span>
                  </div>
                )}
                {t.notes && <p className="mt-1 text-xs text-muted-foreground">{t.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <MapLink url={resolveMapUrl(null, t.pickup_location, trip.destination)} label="נקודת איסוף" />
                  <DirectionsLink place={t.pickup_location} near={trip.destination} />
                  {t.phone && (
                    <a
                      href={`tel:${t.phone}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold"
                    >
                      <Phone className="size-3.5" /> {t.phone}
                    </a>
                  )}
                  <LinkChip url={t.url} label="פרטי ההזמנה" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Live search helpers */}
      <section className="mb-4">
        <h3 className="mb-2 font-bold">🔎 תחבורה ביעד</h3>
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-xs text-muted-foreground">
            חיפוש חי במפות — תמיד מעודכן, גם אם ספקים משתנים.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <LinkChip url={taxiSearchUrl(trip.destination)} label="מוניות ביעד" icon={<Car className="size-3.5" />} />
            <LinkChip
              url={carRentalSearchUrl(arrivalAirport ? `${arrivalAirport} airport` : trip.destination)}
              label="השכרת רכב"
              icon={<Car className="size-3.5" />}
            />
            <MapLink url={airportMapUrl(arrivalAirport)} label="שדה התעופה" />
          </div>
          <div className="mt-1 flex items-start gap-1.5 rounded-2xl bg-muted p-2.5 text-[11px] text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              אפליקציות הסעות משתנות ממדינה למדינה (Uber, Bolt, Grab ועוד). כדאי לבדוק מה פעיל ביעד
              לפני הנסיעה.
            </span>
          </div>
        </Card>
      </section>
    </div>
  );
}
