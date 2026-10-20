import { useEffect, useState } from "react";
import { Car, CircleAlert, ExternalLink, MapPin, MoreHorizontal, Navigation, Pencil, Phone, Plane, Plus, Radar, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Flight, Stay, Transfer } from "@/lib/types";
import { useTrip } from "./TripLayout";
import { can } from "@/lib/permissions";
import { TripHeader } from "@/components/TripHeader";
import { Button, Field, FullSpinner, GroupedList, Input, ListRow, Modal, Segmented, SheetRow } from "@/components/ui";
import {
  airportMapUrl,
  carRentalSearchUrl,
  directionsUrl,
  flightStatusUrl,
  isSafeHttpUrl,
  resolveMapUrl,
  taxiSearchUrl,
} from "@/lib/maps";
import { formatDateTimeHeb, formatHeb, formatTimeHeb } from "@/lib/trip-options";
import { dateRangeHeb } from "@/lib/trip-dates";

// A native datetime-local input's hour format follows the OS/browser locale,
// not the page's lang="he" — on a Windows box set to English that renders an
// AM/PM picker no matter what we do to the page. A date input plus explicit
// 00-23 / 00-59 <select>s sidesteps that entirely: always 24-hour, everywhere.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const DURATION_HOURS = Array.from({ length: 21 }, (_, i) => String(i));

const ISRAEL_AIRPORT = "TLV";
const OTHER_AIRLINE = "__other__";
// A convenience shortlist, not a claim of who currently flies the route —
// routes to/from Israel shift with the news, so "אחר" always stays an option.
const AIRLINES = [
  "אל על",
  "ישראייר",
  "ארקיע",
  "Wizz Air",
  "Ryanair",
  "easyJet",
  "Lufthansa",
  "Air France",
  "KLM",
  "British Airways",
  "SWISS",
  "Turkish Airlines",
  "Aegean Airlines",
  "LOT Polish Airlines",
  "Pegasus Airlines",
  "United Airlines",
  "Delta Air Lines",
  "American Airlines",
  "Emirates",
  "Etihad Airways",
  "flydubai",
  "Ethiopian Airlines",
  "Cyprus Airways",
];

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
function msToDurationParts(ms: number): { hours: string; minutes: string } {
  const totalMin = Math.round(ms / 60000);
  return { hours: String(Math.floor(totalMin / 60)), minutes: String(totalMin % 60).padStart(2, "0") };
}
/** Arrival = departure + flight duration, computed instead of asked for directly. */
function addDurationIso(departIso: string | null, hours: string, minutes: string): string | null {
  if (!departIso || (!hours && !minutes)) return null;
  const d = new Date(departIso);
  if (isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + (Number(hours) || 0) * 60 + (Number(minutes) || 0));
  return d.toISOString();
}

type FlightDraft = {
  id?: string;
  direction: "outbound" | "inbound";
  airline: string;
  airlineOther: string;
  flight_number: string;
  /** The non-Israel side of the route — the Israel side is implied by direction. */
  otherAirport: string;
  depart_date: string;
  depart_hour: string;
  depart_minute: string;
  duration_hours: string;
  duration_minutes: string;
  baggage: string;
  notes: string;
};

const blankFlight: FlightDraft = {
  direction: "outbound",
  airline: "",
  airlineOther: "",
  flight_number: "",
  otherAirport: "",
  depart_date: "",
  depart_hour: "",
  depart_minute: "",
  duration_hours: "",
  duration_minutes: "",
  baggage: "",
  notes: "",
};

function flightToDraft(f: Flight): FlightDraft {
  const airline = f.airline ?? "";
  const knownAirline = AIRLINES.includes(airline);
  const ms =
    f.depart_at && f.arrive_at ? new Date(f.arrive_at).getTime() - new Date(f.depart_at).getTime() : NaN;
  const dur = isFinite(ms) && ms > 0 ? msToDurationParts(ms) : { hours: "", minutes: "" };
  return {
    id: f.id,
    direction: f.direction === "inbound" ? "inbound" : "outbound",
    airline: knownAirline ? airline : airline ? OTHER_AIRLINE : "",
    airlineOther: knownAirline ? "" : airline,
    flight_number: f.flight_number ?? "",
    otherAirport: (f.direction === "inbound" ? f.from_airport : f.to_airport) ?? "",
    depart_date: isoToDatePart(f.depart_at),
    depart_hour: isoToHour(f.depart_at),
    depart_minute: isoToMinute(f.depart_at),
    duration_hours: dur.hours,
    duration_minutes: dur.minutes,
    baggage: f.baggage ?? "",
    notes: f.notes ?? "",
  };
}

type StayDraft = {
  id?: string;
  hotel_name: string;
  address: string;
  /** Calendar days as typed (`stays.check_in/check_out` are DATE columns) — never parsed as a Date. */
  check_in: string;
  check_out: string;
  booking_ref: string;
  phone: string;
  notes: string;
};

const blankStay: StayDraft = { hotel_name: "", address: "", check_in: "", check_out: "", booking_ref: "", phone: "", notes: "" };

function stayToDraft(s: Stay): StayDraft {
  return {
    id: s.id,
    hotel_name: s.hotel_name ?? "",
    address: s.address ?? "",
    check_in: s.check_in?.slice(0, 10) ?? "",
    check_out: s.check_out?.slice(0, 10) ?? "",
    booking_ref: s.booking_ref ?? "",
    phone: s.phone ?? "",
    notes: s.notes ?? "",
  };
}

type TransferDraft = {
  id?: string;
  kind: "transfer" | "car_rental";
  provider: string;
  pickup_location: string;
  pickup_date: string;
  pickup_hour: string;
  pickup_minute: string;
  dropoff_location: string;
  return_date: string;
  return_hour: string;
  return_minute: string;
  booking_ref: string;
  phone: string;
  notes: string;
};

const blankTransfer: TransferDraft = {
  kind: "transfer",
  provider: "",
  pickup_location: "",
  pickup_date: "",
  pickup_hour: "",
  pickup_minute: "",
  dropoff_location: "",
  return_date: "",
  return_hour: "",
  return_minute: "",
  booking_ref: "",
  phone: "",
  notes: "",
};

function transferToDraft(t: Transfer): TransferDraft {
  return {
    id: t.id,
    kind: t.kind === "car_rental" ? "car_rental" : "transfer",
    provider: t.provider ?? "",
    pickup_location: t.pickup_location ?? "",
    pickup_date: isoToDatePart(t.pickup_at),
    pickup_hour: isoToHour(t.pickup_at),
    pickup_minute: isoToMinute(t.pickup_at),
    dropoff_location: t.dropoff_location ?? "",
    return_date: isoToDatePart(t.return_at),
    return_hour: isoToHour(t.return_at),
    return_minute: isoToMinute(t.return_at),
    booking_ref: t.booking_ref ?? "",
    phone: t.phone ?? "",
    notes: t.notes ?? "",
  };
}

/** 24-hour hour:minute pickers (see HOURS above for why not a native time input). */
function TimeSelect({
  hour,
  minute,
  onChange,
}: {
  hour: string;
  minute: string;
  onChange: (hour: string, minute: string) => void;
}) {
  const cls = "h-12 flex-1 rounded-2xl border border-input bg-card px-1 text-center text-sm";
  return (
    <div className="flex items-center gap-1">
      <select value={hour} onChange={(e) => onChange(e.target.value, minute)} className={cls} aria-label="שעה">
        <option value="">--</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="font-bold text-muted-foreground">:</span>
      <select value={minute} onChange={(e) => onChange(hour, e.target.value)} className={cls} aria-label="דקות">
        <option value="">--</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
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

type SheetAction = {
  icon: JSX.Element;
  label: string;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
};

/** A phone number as a tel: link (digits and a leading + only), or null. */
function telHref(phone?: string | null): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return digits.length >= 6 ? `tel:${digits}` : null;
}

/** `embedded`: shown inside another screen (the agency trip screen) — no trip header, no side padding. */
export default function TransportTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { trip, role } = useTrip();
  const canEdit = can(role, "edit");
  const toast = useToast();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FlightDraft | null>(null);
  const [editingStay, setEditingStay] = useState<StayDraft | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<TransferDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; actions: SheetAction[] } | null>(null);

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
    const airline = (editing.airline === OTHER_AIRLINE ? editing.airlineOther : editing.airline).trim() || null;
    const otherAirport = editing.otherAirport.trim() || null;
    const depart_at = partsToIso(editing.depart_date, editing.depart_hour, editing.depart_minute);
    const payload = {
      trip_id: trip.id,
      direction: editing.direction,
      airline,
      flight_number: editing.flight_number.trim() || null,
      from_airport: editing.direction === "outbound" ? ISRAEL_AIRPORT : otherAirport,
      to_airport: editing.direction === "outbound" ? otherAirport : ISRAEL_AIRPORT,
      depart_at,
      arrive_at: addDurationIso(depart_at, editing.duration_hours, editing.duration_minutes),
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

  const saveStay = async () => {
    if (!editingStay) return;
    const hotel_name = editingStay.hotel_name.trim();
    if (!hotel_name) {
      toast.error("צריך שם למקום הלינה");
      return;
    }
    const { check_in, check_out } = editingStay;
    // Both are YYYY-MM-DD, so string order is calendar order.
    if (check_in && check_out && check_out < check_in) {
      toast.error("תאריך העזיבה לפני תאריך ההגעה");
      return;
    }
    setSaving(true);
    const payload = {
      trip_id: trip.id,
      hotel_name,
      address: editingStay.address.trim() || null,
      check_in: check_in || null,
      check_out: check_out || null,
      booking_ref: editingStay.booking_ref.trim() || null,
      phone: editingStay.phone.trim() || null,
      notes: editingStay.notes.trim() || null,
    };
    const { error } = editingStay.id
      ? await supabase.from("stays").update(payload).eq("id", editingStay.id)
      : await supabase.from("stays").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה");
      return;
    }
    setEditingStay(null);
    toast.success("נשמר");
    reload();
  };

  const removeStay = async (s: Stay) => {
    const { error } = await supabase.from("stays").delete().eq("id", s.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      return;
    }
    toast.success("הלינה הוסרה");
    reload();
  };

  const saveTransfer = async () => {
    if (!editingTransfer) return;
    const d = editingTransfer;
    const pickup_at = partsToIso(d.pickup_date, d.pickup_hour, d.pickup_minute);
    const return_at = d.kind === "car_rental" ? partsToIso(d.return_date, d.return_hour, d.return_minute) : null;
    if (pickup_at && return_at && return_at < pickup_at) {
      toast.error("מועד ההחזרה לפני מועד האיסוף");
      return;
    }
    setSaving(true);
    const payload = {
      trip_id: trip.id,
      kind: d.kind,
      provider: d.provider.trim() || null,
      pickup_location: d.pickup_location.trim() || null,
      pickup_at,
      dropoff_location: d.dropoff_location.trim() || null,
      return_at,
      booking_ref: d.booking_ref.trim() || null,
      phone: d.phone.trim() || null,
      notes: d.notes.trim() || null,
    };
    const { error } = d.id
      ? await supabase.from("transfers").update(payload).eq("id", d.id)
      : await supabase.from("transfers").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה");
      return;
    }
    setEditingTransfer(null);
    toast.success("נשמר");
    reload();
  };

  const removeTransfer = async (t: Transfer) => {
    const { error } = await supabase.from("transfers").delete().eq("id", t.id);
    if (error) {
      toast.error("המחיקה נכשלה");
      return;
    }
    toast.success(t.kind === "car_rental" ? "הרכב הוסר" : "ההעברה הוסרה");
    reload();
  };

  if (loading) return <FullSpinner />;

  const arrivalAirport = flights.find((f) => f.direction === "outbound")?.to_airport ?? null;

  const now = new Date();
  const openSheet = (title: string, actions: (SheetAction | null | false | "" | undefined)[]) =>
    setSheet({ title, actions: actions.filter((a): a is SheetAction => !!a) });

  return (
    <div className={embedded ? undefined : "px-4"}>
      {!embedded && <TripHeader trip={trip} subtitle="טיסות, לינה ותחבורה" />}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-title">טיסות ולינה</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing({ ...blankFlight })}
            aria-label="הוספת טיסה"
            className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        )}
      </div>

      {/* Flights — the boarding-pass layout stays: at the airport this is what people need. */}
      <GroupedList title="טיסות">
        {flights.length === 0 ? (
          <p className="type-footnote px-4 py-3 text-muted-foreground">לא הוזנו טיסות.</p>
        ) : (
          flights.map((f) => {
            const dur = duration(f.depart_at, f.arrive_at);
            return (
              <div key={f.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="type-footnote shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 font-semibold text-primary">
                    {f.direction === "inbound" ? "חזור" : "הלוך"}
                  </span>
                  {/* Sized to its text (not flex-1) so an English name sits next to the chip and truncates at its own end. */}
                  <span dir="auto" className="type-footnote min-w-0 truncate font-semibold">
                    {[f.airline, f.flight_number].filter(Boolean).join(" ")}
                  </span>
                  {(canEdit || flightStatusUrl(f.airline, f.flight_number) || airportMapUrl(f.from_airport) || airportMapUrl(f.to_airport)) && (
                  <button
                    type="button"
                    onClick={() =>
                      openSheet([f.airline, f.flight_number].filter(Boolean).join(" ") || "טיסה", [
                        flightStatusUrl(f.airline, f.flight_number) && {
                          icon: <Radar className="size-5" />,
                          label: "סטטוס טיסה",
                          href: flightStatusUrl(f.airline, f.flight_number)!,
                        },
                        airportMapUrl(f.from_airport) && {
                          icon: <MapPin className="size-5" />,
                          label: `שדה ${f.from_airport}`,
                          href: airportMapUrl(f.from_airport)!,
                        },
                        airportMapUrl(f.to_airport) && {
                          icon: <MapPin className="size-5" />,
                          label: `שדה ${f.to_airport}`,
                          href: airportMapUrl(f.to_airport)!,
                        },
                        canEdit && { icon: <Pencil className="size-5" />, label: "עריכה", onClick: () => setEditing(flightToDraft(f)) },
                        canEdit && { icon: <Trash2 className="size-5" />, label: "מחיקה", destructive: true, onClick: () => removeFlight(f) },
                      ])
                    }
                    aria-label="אפשרויות לטיסה"
                    className="-me-3 ms-auto grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                  >
                    <MoreHorizontal className="size-5" />
                  </button>
                  )}
                </div>

                {/* Route: always left-to-right, each airport isolated (Hebrew names keep their order). */}
                <div dir="ltr" className="mt-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1 text-start">
                    <div className="type-title line-clamp-2 [overflow-wrap:anywhere]">
                      <bdi>{f.from_airport || "—"}</bdi>
                    </div>
                    <div className="type-footnote font-semibold tabular-nums">{formatTimeHeb(f.depart_at)}</div>
                    {/* A Hebrew date inside the left-to-right route keeps its own direction. */}
                    <div className="type-footnote text-muted-foreground">
                      <bdi dir="rtl">{formatHeb(f.depart_at)}</bdi>
                    </div>
                    {f.from_terminal && (
                      <div className="type-footnote text-muted-foreground">
                        <bdi dir="rtl">טרמינל {f.from_terminal}</bdi>
                      </div>
                    )}
                  </div>
                  <div className="flex w-16 shrink-0 flex-col items-center pt-2 text-muted-foreground">
                    <Plane className="size-4" />
                    <div className="my-1 h-px w-full bg-border" />
                    {dur && <span className="type-footnote" dir="rtl">{dur}</span>}
                  </div>
                  <div className="min-w-0 flex-1 text-end">
                    <div className="type-title line-clamp-2 [overflow-wrap:anywhere]">
                      <bdi>{f.to_airport || "—"}</bdi>
                    </div>
                    <div className="type-footnote font-semibold tabular-nums">{formatTimeHeb(f.arrive_at)}</div>
                    <div className="type-footnote text-muted-foreground">
                      <bdi dir="rtl">{formatHeb(f.arrive_at)}</bdi>
                    </div>
                    {f.to_terminal && (
                      <div className="type-footnote text-muted-foreground">
                        <bdi dir="rtl">טרמינל {f.to_terminal}</bdi>
                      </div>
                    )}
                  </div>
                </div>

                {(f.booking_ref || f.seats || f.baggage) && (
                  <div className="type-footnote mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    {f.booking_ref && (
                      <span>
                        אסמכתה{" "}
                        <bdi className="font-semibold tracking-wide text-foreground">{f.booking_ref}</bdi>
                      </span>
                    )}
                    {f.seats && (
                      <span>
                        מושבים <bdi className="font-semibold text-foreground">{f.seats}</bdi>
                      </span>
                    )}
                    {f.baggage && (
                      <span>
                        כבודה <bdi className="font-semibold text-foreground">{f.baggage}</bdi>
                      </span>
                    )}
                  </div>
                )}
                {f.notes && <p className="type-footnote mt-1 text-muted-foreground [overflow-wrap:anywhere]">{f.notes}</p>}
              </div>
            );
          })
        )}
      </GroupedList>

      <GroupedList
        title="לינה"
        className="mt-6"
        action={canEdit && <AddButton label="הוספת לינה" onClick={() => setEditingStay({ ...blankStay })} />}
      >
        {stays.length === 0 ? (
          <p className="type-footnote px-4 py-3 text-muted-foreground">לא הוזנה לינה.</p>
        ) : (
          stays.map((st) => {
            const place = st.address || st.hotel_name;
            const mapUrl = resolveMapUrl(st.map_url, place, trip.destination);
            return (
              <div key={st.id} className="flex items-start gap-3 py-3 ps-4 pe-1">
                <div className="min-w-0 flex-1">
                  <div className="type-headline [overflow-wrap:anywhere]">
                    <bdi>{st.hotel_name}</bdi>
                  </div>
                  {st.address && (
                    <div className="type-footnote text-muted-foreground">
                      <bdi>{st.address}</bdi>
                    </div>
                  )}
                  {(st.check_in || st.check_out) && (
                    <div className="type-footnote mt-0.5 text-muted-foreground">{dateRangeHeb(st.check_in ?? st.check_out, st.check_out, now)}</div>
                  )}
                  {st.booking_ref && (
                    <div className="type-footnote text-muted-foreground">
                      אסמכתה <bdi className="font-semibold tracking-wide text-foreground">{st.booking_ref}</bdi>
                    </div>
                  )}
                  {st.notes && <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{st.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openSheet(st.hotel_name, [
                      mapUrl && isSafeHttpUrl(mapUrl) && { icon: <MapPin className="size-5" />, label: "פתיחה במפה", href: mapUrl },
                      directionsUrl(place, trip.destination) && {
                        icon: <Navigation className="size-5" />,
                        label: "ניווט",
                        href: directionsUrl(place, trip.destination)!,
                      },
                      telHref(st.phone) && { icon: <Phone className="size-5" />, label: `התקשרות \u2066${st.phone}\u2069`, href: telHref(st.phone)! },
                      st.url && isSafeHttpUrl(st.url) && { icon: <ExternalLink className="size-5" />, label: "אתר המלון", href: st.url },
                      canEdit && { icon: <Pencil className="size-5" />, label: "עריכה", onClick: () => setEditingStay(stayToDraft(st)) },
                      canEdit && { icon: <Trash2 className="size-5" />, label: "מחיקה", destructive: true, onClick: () => removeStay(st) },
                    ])
                  }
                  aria-label={`אפשרויות ל${st.hotel_name}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                >
                  <MoreHorizontal className="size-5" />
                </button>
              </div>
            );
          })
        )}
      </GroupedList>

      <GroupedList
        title="העברות ורכב"
        className="mt-6"
        action={canEdit && <AddButton label="הוספת העברה או רכב" onClick={() => setEditingTransfer({ ...blankTransfer })} />}
      >
        {transfers.length === 0 ? (
          <p className="type-footnote px-4 py-3 text-muted-foreground">לא הוזנו העברות.</p>
        ) : (
          transfers.map((t) => {
            const pickupMap = resolveMapUrl(null, t.pickup_location, trip.destination);
            return (
              <div key={t.id} className="flex items-start gap-3 py-3 ps-4 pe-1">
                <Car className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="type-headline">
                    {t.kind === "car_rental" ? "רכב שכור" : "העברה"}
                    {t.provider && <span className="font-normal text-muted-foreground"> · {t.provider}</span>}
                  </div>
                  {t.pickup_location && (
                    <div className="type-footnote text-muted-foreground [overflow-wrap:anywhere]">
                      {/* The place is often English: isolate it so the Hebrew line keeps its order. */}
                      איסוף: <bdi>{t.pickup_location}</bdi>
                      {t.pickup_at && <> · <bdi>{formatDateTimeHeb(t.pickup_at)}</bdi></>}
                    </div>
                  )}
                  {t.dropoff_location && (
                    <div className="type-footnote text-muted-foreground [overflow-wrap:anywhere]">
                      החזרה: <bdi>{t.dropoff_location}</bdi>
                    </div>
                  )}
                  {t.return_at && <div className="type-footnote text-muted-foreground">מועד החזרה: {formatDateTimeHeb(t.return_at)}</div>}
                  {t.booking_ref && (
                    <div className="type-footnote text-muted-foreground">
                      אסמכתה <bdi className="font-semibold tracking-wide text-foreground">{t.booking_ref}</bdi>
                    </div>
                  )}
                  {t.notes && <p className="type-footnote mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{t.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openSheet(t.kind === "car_rental" ? "רכב שכור" : "העברה", [
                      pickupMap && isSafeHttpUrl(pickupMap) && { icon: <MapPin className="size-5" />, label: "נקודת איסוף במפה", href: pickupMap },
                      directionsUrl(t.pickup_location, trip.destination) && {
                        icon: <Navigation className="size-5" />,
                        label: "ניווט לנקודת האיסוף",
                        href: directionsUrl(t.pickup_location, trip.destination)!,
                      },
                      telHref(t.phone) && { icon: <Phone className="size-5" />, label: `התקשרות \u2066${t.phone}\u2069`, href: telHref(t.phone)! },
                      t.url && isSafeHttpUrl(t.url) && { icon: <ExternalLink className="size-5" />, label: "פרטי ההזמנה", href: t.url },
                      canEdit && { icon: <Pencil className="size-5" />, label: "עריכה", onClick: () => setEditingTransfer(transferToDraft(t)) },
                      canEdit && { icon: <Trash2 className="size-5" />, label: "מחיקה", destructive: true, onClick: () => removeTransfer(t) },
                    ])
                  }
                  aria-label="אפשרויות להעברה"
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                >
                  <MoreHorizontal className="size-5" />
                </button>
              </div>
            );
          })
        )}
      </GroupedList>

      {/* Live searches at the destination */}
      <GroupedList title="תחבורה ביעד" className="mt-6">
        {[
          { href: taxiSearchUrl(trip.destination), label: "מוניות ביעד", icon: <Car className="size-5" /> },
          {
            href: carRentalSearchUrl(arrivalAirport ? `${arrivalAirport} airport` : trip.destination),
            label: "השכרת רכב",
            icon: <Car className="size-5" />,
          },
          { href: airportMapUrl(arrivalAirport), label: "שדה התעופה", icon: <MapPin className="size-5" /> },
        ]
          .filter((l): l is { href: string; label: string; icon: JSX.Element } => !!l.href && isSafeHttpUrl(l.href))
          .map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center gap-3 px-4 py-3 transition-colors active:bg-muted/70"
            >
              <span className="text-primary">{l.icon}</span>
              <span className="type-headline flex-1">{l.label}</span>
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
          ))}
      </GroupedList>
      <p className="type-footnote mt-2 flex items-start gap-1.5 px-4 text-muted-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>חיפוש חי במפות, תמיד מעודכן. אפליקציות הסעות משתנות ממדינה למדינה (Uber, Bolt, Grab ועוד), כדאי לבדוק מה פעיל ביעד לפני הנסיעה.</span>
      </p>

      <Modal open={!!sheet} onClose={() => setSheet(null)} title={sheet?.title ?? ""}>
        {sheet && (
          <div className="flex flex-col gap-2">
            {sheet.actions.map((a, i) => (
              <SheetRow
                key={`${i}-${a.label}`}
                icon={a.icon}
                label={a.label}
                href={a.href}
                destructive={a.destructive}
                onClick={
                  a.onClick
                    ? () => {
                        setSheet(null);
                        a.onClick!();
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </Modal>

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
                <select
                  value={editing.airline}
                  onChange={(e) => setEditing({ ...editing, airline: e.target.value })}
                  className="h-12 w-full rounded-2xl border border-input bg-card px-2 text-sm"
                >
                  <option value="">בחר חברה</option>
                  {AIRLINES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                  <option value={OTHER_AIRLINE}>אחר...</option>
                </select>
              </Field>
              <Field label="מספר טיסה">
                <Input
                  value={editing.flight_number}
                  onChange={(e) => setEditing({ ...editing, flight_number: e.target.value })}
                />
              </Field>
            </div>
            {editing.airline === OTHER_AIRLINE && (
              <Field label="שם החברה">
                <Input
                  value={editing.airlineOther}
                  onChange={(e) => setEditing({ ...editing, airlineOther: e.target.value })}
                />
              </Field>
            )}

            <Field label={editing.direction === "outbound" ? "לאן טסים" : "מאיפה חוזרים"}>
              <Input
                value={editing.otherAirport}
                onChange={(e) => setEditing({ ...editing, otherAirport: e.target.value })}
                placeholder="למשל CDG, פריז"
              />
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">
              {editing.direction === "outbound"
                ? "המראה מישראל (TLV) מתמלאת אוטומטית."
                : "נחיתה בישראל (TLV) מתמלאת אוטומטית."}
            </p>

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

            <Field label="משך הטיסה">
              <div className="flex items-center gap-2">
                <select
                  value={editing.duration_hours}
                  onChange={(e) => setEditing({ ...editing, duration_hours: e.target.value })}
                  className="h-12 flex-1 rounded-2xl border border-input bg-card px-2 text-center text-sm"
                >
                  <option value="">--</option>
                  {DURATION_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h} שעות
                    </option>
                  ))}
                </select>
                <select
                  value={editing.duration_minutes}
                  onChange={(e) => setEditing({ ...editing, duration_minutes: e.target.value })}
                  className="h-12 flex-1 rounded-2xl border border-input bg-card px-2 text-center text-sm"
                >
                  <option value="">--</option>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {m} דק'
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">שעת הנחיתה מחושבת אוטומטית לפי ההמראה ומשך הטיסה.</p>

            <div className="grid grid-cols-2 gap-2">
              <Field label="כבודה">
                <Input value={editing.baggage} onChange={(e) => setEditing({ ...editing, baggage: e.target.value })} />
              </Field>
              <Field label="הערות">
                <Input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editingStay}
        onClose={() => setEditingStay(null)}
        title={editingStay?.id ? "עריכת לינה" : "לינה חדשה"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditingStay(null)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={saveStay}>
              שמירה
            </Button>
          </>
        }
      >
        {editingStay && (
          <div className="flex flex-col gap-3">
            <Field label="שם המלון או מקום הלינה">
              <Input
                value={editingStay.hotel_name}
                onChange={(e) => setEditingStay({ ...editingStay, hotel_name: e.target.value })}
                dir="auto"
                maxLength={200}
              />
            </Field>
            <Field label="כתובת">
              <Input
                value={editingStay.address}
                onChange={(e) => setEditingStay({ ...editingStay, address: e.target.value })}
                dir="auto"
                maxLength={300}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="הגעה">
                <Input
                  type="date"
                  value={editingStay.check_in}
                  onChange={(e) => setEditingStay({ ...editingStay, check_in: e.target.value })}
                />
              </Field>
              <Field label="עזיבה">
                <Input
                  type="date"
                  value={editingStay.check_out}
                  min={editingStay.check_in || undefined}
                  onChange={(e) => setEditingStay({ ...editingStay, check_out: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="מספר הזמנה">
                <Input
                  value={editingStay.booking_ref}
                  onChange={(e) => setEditingStay({ ...editingStay, booking_ref: e.target.value })}
                  dir="ltr"
                />
              </Field>
              <Field label="טלפון">
                <Input
                  type="tel"
                  inputMode="tel"
                  value={editingStay.phone}
                  onChange={(e) => setEditingStay({ ...editingStay, phone: e.target.value })}
                  dir="ltr"
                />
              </Field>
            </div>
            <Field label="הערות">
              <Input value={editingStay.notes} onChange={(e) => setEditingStay({ ...editingStay, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editingTransfer}
        onClose={() => setEditingTransfer(null)}
        title={
          editingTransfer?.id
            ? editingTransfer.kind === "car_rental"
              ? "עריכת רכב שכור"
              : "עריכת העברה"
            : editingTransfer?.kind === "car_rental"
              ? "רכב שכור חדש"
              : "העברה חדשה"
        }
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setEditingTransfer(null)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={saveTransfer}>
              שמירה
            </Button>
          </>
        }
      >
        {editingTransfer && (
          <div className="flex flex-col gap-3">
            <Segmented
              options={[
                { value: "transfer", label: "העברה" },
                { value: "car_rental", label: "רכב שכור" },
              ]}
              value={editingTransfer.kind}
              onChange={(v) => setEditingTransfer({ ...editingTransfer, kind: v as TransferDraft["kind"] })}
            />
            <Field label={editingTransfer.kind === "car_rental" ? "חברת ההשכרה" : "חברת ההסעות"}>
              <Input
                value={editingTransfer.provider}
                onChange={(e) => setEditingTransfer({ ...editingTransfer, provider: e.target.value })}
                dir="auto"
                maxLength={200}
              />
            </Field>
            <Field label="נקודת איסוף">
              <Input
                value={editingTransfer.pickup_location}
                onChange={(e) => setEditingTransfer({ ...editingTransfer, pickup_location: e.target.value })}
                dir="auto"
                placeholder="למשל שדה התעופה CDG"
                maxLength={300}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="תאריך איסוף">
                <Input
                  type="date"
                  value={editingTransfer.pickup_date}
                  onChange={(e) => setEditingTransfer({ ...editingTransfer, pickup_date: e.target.value })}
                />
              </Field>
              <Field label="שעת איסוף (24 שעות)">
                <TimeSelect
                  hour={editingTransfer.pickup_hour}
                  minute={editingTransfer.pickup_minute}
                  onChange={(pickup_hour, pickup_minute) => setEditingTransfer({ ...editingTransfer, pickup_hour, pickup_minute })}
                />
              </Field>
            </div>
            <Field label={editingTransfer.kind === "car_rental" ? "נקודת החזרה" : "יעד ההעברה"}>
              <Input
                value={editingTransfer.dropoff_location}
                onChange={(e) => setEditingTransfer({ ...editingTransfer, dropoff_location: e.target.value })}
                dir="auto"
                maxLength={300}
              />
            </Field>
            {editingTransfer.kind === "car_rental" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="תאריך החזרה">
                  <Input
                    type="date"
                    value={editingTransfer.return_date}
                    min={editingTransfer.pickup_date || undefined}
                    onChange={(e) => setEditingTransfer({ ...editingTransfer, return_date: e.target.value })}
                  />
                </Field>
                <Field label="שעת החזרה (24 שעות)">
                  <TimeSelect
                    hour={editingTransfer.return_hour}
                    minute={editingTransfer.return_minute}
                    onChange={(return_hour, return_minute) => setEditingTransfer({ ...editingTransfer, return_hour, return_minute })}
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="מספר הזמנה">
                <Input
                  value={editingTransfer.booking_ref}
                  onChange={(e) => setEditingTransfer({ ...editingTransfer, booking_ref: e.target.value })}
                  dir="ltr"
                />
              </Field>
              <Field label="טלפון">
                <Input
                  type="tel"
                  inputMode="tel"
                  value={editingTransfer.phone}
                  onChange={(e) => setEditingTransfer({ ...editingTransfer, phone: e.target.value })}
                  dir="ltr"
                />
              </Field>
            </div>
            <Field label="הערות">
              <Input
                value={editingTransfer.notes}
                onChange={(e) => setEditingTransfer({ ...editingTransfer, notes: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The "add" control in a section's title row (GroupedList action). */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="type-footnote -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 font-semibold text-primary transition-colors active:bg-muted/70"
    >
      <Plus className="size-4" aria-hidden />
      הוספה
    </button>
  );
}
