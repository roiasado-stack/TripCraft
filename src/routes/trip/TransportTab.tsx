import { useEffect, useState } from "react";
import { Car, CircleAlert, Luggage, Pencil, Phone, Plane, Plus, Radar, Ticket, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Flight, Stay, Transfer } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { TripHeader, ScreenTitle } from "@/components/TripHeader";
import { Button, Card, Field, FullSpinner, Input, Modal, Segmented } from "@/components/ui";
import { DirectionsLink, LinkChip, MapLink } from "@/components/MapLink";
import {
  airportMapUrl,
  carRentalSearchUrl,
  flightStatusUrl,
  resolveMapUrl,
  taxiSearchUrl,
} from "@/lib/maps";
import { formatDateTimeHeb, formatHeb, formatTimeHeb } from "@/lib/trip-options";

// A native datetime-local input's hour format follows the OS/browser locale,
// not the page's lang="he" — on a Windows box set to English that renders an
// AM/PM picker no matter what we do to the page. A date input plus explicit
// 00-23 / 00-59 <select>s sidesteps that entirely: always 24-hour, everywhere.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function isoToDatePart(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToHour(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? String(d.getHours()).padStart(2, "0") : "";
}
function isoToMinute(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? String(d.getMinutes()).padStart(2, "0") : "";
}
function partsToIso(date: string, hour: string, minute: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${hour || "00"}:${minute || "00"}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

type FlightDraft = {
  id?: string;
  direction: "outbound" | "inbound";
  airline: string;
  flight_number: string;
  from_airport: string;
  to_airport: string;
  from_terminal: string;
  to_terminal: string;
  depart_date: string;
  depart_hour: string;
  depart_minute: string;
  arrive_date: string;
  arrive_hour: string;
  arrive_minute: string;
  booking_ref: string;
  seats: string;
  baggage: string;
  notes: string;
};

const blankFlight: FlightDraft = {
  direction: "outbound",
  airline: "",
  flight_number: "",
  from_airport: "",
  to_airport: "",
  from_terminal: "",
  to_terminal: "",
  depart_date: "",
  depart_hour: "",
  depart_minute: "",
  arrive_date: "",
  arrive_hour: "",
  arrive_minute: "",
  booking_ref: "",
  seats: "",
  baggage: "",
  notes: "",
};

function flightToDraft(f: Flight): FlightDraft {
  return {
    id: f.id,
    direction: f.direction === "inbound" ? "inbound" : "outbound",
    airline: f.airline ?? "",
    flight_number: f.flight_number ?? "",
    from_airport: f.from_airport ?? "",
    to_airport: f.to_airport ?? "",
    from_terminal: f.from_terminal ?? "",
    to_terminal: f.to_terminal ?? "",
    depart_date: isoToDatePart(f.depart_at),
    depart_hour: isoToHour(f.depart_at),
    depart_minute: isoToMinute(f.depart_at),
    arrive_date: isoToDatePart(f.arrive_at),
    arrive_hour: isoToHour(f.arrive_at),
    arrive_minute: isoToMinute(f.arrive_at),
    booking_ref: f.booking_ref ?? "",
    seats: f.seats ?? "",
    baggage: f.baggage ?? "",
    notes: f.notes ?? "",
  };
}

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
  const toast = useToast();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FlightDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const [f, s, t] = await Promise.all([
      supabase.from("flights").select("*").eq("trip_id", trip.id).order("depart_at"),
      supabase.from("stays").select("*").eq("trip_id", trip.id).order("check_in"),
      supabase.from("transfers").select("*").eq("trip_id", trip.id).order("pickup_at"),
    ]);
    setFlights((f.data as Flight[]) ?? []);
    setStays((s.data as Stay[]) ?? []);
    setTransfers((t.data as Transfer[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const saveFlight = async () => {
    if (!editing) return;
    setSaving(true);
    const payload = {
      trip_id: trip.id,
      direction: editing.direction,
      airline: editing.airline.trim() || null,
      flight_number: editing.flight_number.trim() || null,
      from_airport: editing.from_airport.trim() || null,
      to_airport: editing.to_airport.trim() || null,
      from_terminal: editing.from_terminal.trim() || null,
      to_terminal: editing.to_terminal.trim() || null,
      depart_at: partsToIso(editing.depart_date, editing.depart_hour, editing.depart_minute),
      arrive_at: partsToIso(editing.arrive_date, editing.arrive_hour, editing.arrive_minute),
      booking_ref: editing.booking_ref.trim() || null,
      seats: editing.seats.trim() || null,
      baggage: editing.baggage.trim() || null,
      notes: editing.notes.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from("flights").update(payload).eq("id", editing.id)
      : await supabase.from("flights").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה");
      return;
    }
    setEditing(null);
    toast.success("נשמר");
    reload();
  };

  const removeFlight = async (f: Flight) => {
    const { error } = await supabase.from("flights").delete().eq("id", f.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      return;
    }
    toast.success("הטיסה הוסרה");
    reload();
  };

  if (loading) return <FullSpinner />;

  const arrivalAirport = flights.find((f) => f.direction === "outbound")?.to_airport ?? null;

  return (
    <div className="px-4">
      <TripHeader trip={trip} subtitle="טיסות, לינה ותחבורה" />
      <ScreenTitle title="נסיעה" />

      {/* Flights */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold">✈️ טיסות</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing({ ...blankFlight })}>
            <Plus className="size-4" />
          </Button>
        </div>
        {flights.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">לא הוזנו טיסות.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {flights.map((f) => (
              <Card key={f.id} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-secondary-foreground">
                      {f.direction === "inbound" ? "חזור" : "הלוך"}
                    </span>
                    <span className="truncate text-sm font-bold">
                      {f.airline} {f.flight_number}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setEditing(flightToDraft(f))}
                      className="text-muted-foreground"
                      aria-label="עריכת טיסה"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button onClick={() => removeFlight(f)} className="text-destructive" aria-label="מחיקת טיסה">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "עריכת טיסה" : "טיסה חדשה"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={saveFlight}>
              שמירה
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Segmented
              options={[
                { value: "outbound", label: "הלוך" },
                { value: "inbound", label: "חזור" },
              ]}
              value={editing.direction}
              onChange={(v) => setEditing({ ...editing, direction: v as "outbound" | "inbound" })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="חברת תעופה">
                <Input value={editing.airline} onChange={(e) => setEditing({ ...editing, airline: e.target.value })} />
              </Field>
              <Field label="מספר טיסה">
                <Input
                  value={editing.flight_number}
                  onChange={(e) => setEditing({ ...editing, flight_number: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="משדה (קוד)">
                <Input
                  value={editing.from_airport}
                  onChange={(e) => setEditing({ ...editing, from_airport: e.target.value })}
                />
              </Field>
              <Field label="לשדה (קוד)">
                <Input value={editing.to_airport} onChange={(e) => setEditing({ ...editing, to_airport: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="תאריך המראה">
                <Input
                  type="date"
                  value={editing.depart_date}
                  onChange={(e) => setEditing({ ...editing, depart_date: e.target.value })}
                />
              </Field>
              <Field label="שעת המראה (24 שעות)">
                <div className="flex items-center gap-1">
                  <select
                    value={editing.depart_hour}
                    onChange={(e) => setEditing({ ...editing, depart_hour: e.target.value })}
                    className="h-12 flex-1 rounded-2xl border border-input bg-card px-1 text-center text-sm"
                  >
                    <option value="">--</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="font-bold text-muted-foreground">:</span>
                  <select
                    value={editing.depart_minute}
                    onChange={(e) => setEditing({ ...editing, depart_minute: e.target.value })}
                    className="h-12 flex-1 rounded-2xl border border-input bg-card px-1 text-center text-sm"
                  >
                    <option value="">--</option>
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="תאריך נחיתה">
                <Input
                  type="date"
                  value={editing.arrive_date}
                  onChange={(e) => setEditing({ ...editing, arrive_date: e.target.value })}
                />
              </Field>
              <Field label="שעת נחיתה (24 שעות)">
                <div className="flex items-center gap-1">
                  <select
                    value={editing.arrive_hour}
                    onChange={(e) => setEditing({ ...editing, arrive_hour: e.target.value })}
                    className="h-12 flex-1 rounded-2xl border border-input bg-card px-1 text-center text-sm"
                  >
                    <option value="">--</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="font-bold text-muted-foreground">:</span>
                  <select
                    value={editing.arrive_minute}
                    onChange={(e) => setEditing({ ...editing, arrive_minute: e.target.value })}
                    className="h-12 flex-1 rounded-2xl border border-input bg-card px-1 text-center text-sm"
                  >
                    <option value="">--</option>
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="טרמינל המראה">
                <Input
                  value={editing.from_terminal}
                  onChange={(e) => setEditing({ ...editing, from_terminal: e.target.value })}
                />
              </Field>
              <Field label="טרמינל נחיתה">
                <Input
                  value={editing.to_terminal}
                  onChange={(e) => setEditing({ ...editing, to_terminal: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="אסמכתה">
                <Input
                  value={editing.booking_ref}
                  onChange={(e) => setEditing({ ...editing, booking_ref: e.target.value })}
                />
              </Field>
              <Field label="מושבים">
                <Input value={editing.seats} onChange={(e) => setEditing({ ...editing, seats: e.target.value })} />
              </Field>
              <Field label="כבודה">
                <Input value={editing.baggage} onChange={(e) => setEditing({ ...editing, baggage: e.target.value })} />
              </Field>
            </div>
            <Field label="הערות">
              <Input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
