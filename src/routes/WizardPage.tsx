import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Plus, ScanLine, Ticket, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button, Card, Checkbox, Chip, Field, Input, Label, Segmented, Spinner } from "@/components/ui";
import { ImportParticipants } from "@/components/ImportParticipants";
import { ImportBookings, personKey, type BookingsImportResult, type BookingTraveller } from "@/components/ImportBookings";
import {
  ImportVoucher,
  type VoucherCarData,
  type VoucherData,
  type VoucherDocType,
  type VoucherFlightData,
  type VoucherHotelData,
} from "@/components/ImportVoucher";
import { generateContent } from "@/lib/ai";
import { uploadTripDocument } from "@/lib/documents";
import type { Participant, Trip } from "@/lib/types";
import {
  AGE_RANGES,
  BUDGET_LEVELS,
  COVER_EMOJIS,
  destinationFlag,
  PREFERENCES,
  TRIP_TYPES,
  tripDuration,
} from "@/lib/trip-options";

type PartDraft = {
  name: string;
  ageMode: "age" | "range";
  age: string;
  age_range: string;
  preferences: string[];
};
// The optional fields below have no wizard UI: they carry voucher-scanned
// detail through to create() as hidden values (manually added drafts simply
// leave them unset). `source_file` is the scanned original, uploaded to
// trip-docs once the trip exists — tied to the draft so deleting the draft in
// the logistics step also drops its file.
type FlightDraft = {
  direction: "outbound" | "inbound";
  airline: string;
  flight_number: string;
  from_airport: string;
  to_airport: string;
  depart_at: string;
  arrive_at?: string | null; // ISO / wall-clock datetime
  from_terminal?: string | null;
  to_terminal?: string | null;
  seats?: string | null;
  baggage?: string | null;
  booking_ref?: string | null;
  notes?: string | null;
  source_file?: File | null;
};
type StayDraft = {
  hotel_name: string;
  address: string;
  check_in: string;
  check_out: string;
  booking_ref: string;
  phone?: string | null;
  url?: string | null;
  notes?: string | null;
  source_file?: File | null;
};
type TransferDraft = {
  kind: string;
  provider: string;
  pickup_location: string;
  pickup_at: string;
  dropoff_location?: string | null;
  return_at?: string | null; // ISO / wall-clock datetime
  booking_ref?: string | null;
  phone?: string | null;
  url?: string | null;
  notes?: string | null;
  source_file?: File | null;
};

type TaskStatus = "running" | "done" | "failed";
type BuildState = { suggestions: TaskStatus | null; itinerary: TaskStatus | null; docs: TaskStatus | null };

const STEPS = ["יעד", "משתתפים", "לוגיסטיקה", "סיכום"];

/** Hidden datetime field → ISO for insert; null when empty or unparsable. */
function toIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function flightDraftFromVoucher(d: VoucherFlightData, file: File | null): FlightDraft {
  return {
    direction: d.direction === "inbound" ? "inbound" : "outbound",
    airline: d.airline ?? "",
    flight_number: d.flight_number ?? "",
    from_airport: d.from_airport ?? "",
    to_airport: d.to_airport ?? "",
    depart_at: isoToDatetimeLocalInput(d.depart_at),
    arrive_at: d.arrive_at,
    from_terminal: d.from_terminal,
    to_terminal: d.to_terminal,
    seats: d.seats,
    baggage: d.baggage,
    booking_ref: d.booking_ref,
    notes: d.notes,
    source_file: file,
  };
}
function stayDraftFromVoucher(d: VoucherHotelData, file: File | null): StayDraft {
  return {
    hotel_name: d.hotel_name,
    address: d.address ?? "",
    check_in: d.check_in ?? "",
    check_out: d.check_out ?? "",
    booking_ref: d.booking_ref ?? "",
    phone: d.phone,
    url: d.url,
    notes: d.notes,
    source_file: file,
  };
}
function transferDraftFromVoucher(d: VoucherCarData, file: File | null): TransferDraft {
  return {
    kind: "car_rental",
    provider: d.provider ?? "",
    pickup_location: d.pickup_location ?? "",
    pickup_at: isoToDatetimeLocalInput(d.pickup_at),
    dropoff_location: d.dropoff_location,
    return_at: d.return_at,
    booking_ref: d.booking_ref,
    phone: d.phone,
    url: d.url,
    notes: d.notes,
    source_file: file,
  };
}

/** Booking traveller → participant draft. Unlike the passport path (which
 *  defaults an unknown age to the 30-49 range), an unknown age stays unset
 *  here: exact-age mode with an empty age saves as age/age_range null, and the
 *  user can fill it in on the participants step. */
function travellerToDraft(t: BookingTraveller): PartDraft {
  if (t.age != null) {
    return { name: t.name, ageMode: "age", age: String(t.age), age_range: AGE_RANGES[5], preferences: t.preferences };
  }
  if (t.age_range) {
    return { name: t.name, ageMode: "range", age: "", age_range: t.age_range, preferences: t.preferences };
  }
  return { name: t.name, ageMode: "age", age: "", age_range: AGE_RANGES[5], preferences: t.preferences };
}

/** ["2 טיסות", "מלון אחד", "3 נוסעים"] → "2 טיסות, מלון אחד ו-3 נוסעים". */
function joinHebrew(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} ${/^\d/.test(last) ? "ו-" : "ו"}${last}`;
}
function countHe(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** ISO timestamp → the "YYYY-MM-DDTHH:MM" shape a native datetime-local input
 *  expects. Reads local wall-clock fields off the Date object rather than
 *  slicing the ISO string, so it round-trips correctly regardless of the
 *  timezone offset baked into the ISO value. */
function isoToDatetimeLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WizardPage() {
  const { user, isAgent } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [bookingsOpen, setBookingsOpen] = useState(false);
  // Post-create "the agent builds the rest" step. Defaults ON once the trip
  // has been seeded from bookings, OFF for the manual flow.
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [building, setBuilding] = useState<BuildState | null>(null);

  // step 0
  const [destination, setDestination] = useState("");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tripType, setTripType] = useState<string>("family");
  const [budget, setBudget] = useState<string>("mid");
  const [emoji, setEmoji] = useState<string>("🌴");
  // Agent-only, and only for an organized trip — a private traveler planning
  // their own trip has no "guide" to name. See migration 009.
  const [guideName, setGuideName] = useState("");
  const [guidePhone, setGuidePhone] = useState("");

  // step 1
  const [participants, setParticipants] = useState<PartDraft[]>([]);

  // step 2
  const [flights, setFlights] = useState<FlightDraft[]>([]);
  const [stays, setStays] = useState<StayDraft[]>([]);
  const [transfers, setTransfers] = useState<TransferDraft[]>([]);

  const duration = useMemo(() => tripDuration(startDate, endDate), [startDate, endDate]);
  const effectiveTitle = title.trim() || (destination.trim() ? `טיול ל${destination.trim()}` : "");

  const canNext = () => {
    if (step === 0) return destination.trim().length > 0;
    return true;
  };

  const create = async () => {
    if (!user) return;
    if (!destination.trim()) {
      toast.error("צריך יעד לטיול");
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      const { data: trip, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: effectiveTitle,
          destination: destination.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          trip_type: tripType,
          budget_level: budget,
          cover_emoji: emoji,
          guide_name: isAgent && tripType === "organized" ? guideName.trim() || null : null,
          guide_phone: isAgent && tripType === "organized" ? guidePhone.trim() || null : null,
        })
        .select()
        .single();
      if (error || !trip) throw error;
      const tripId = trip.id;

      // Supabase query builders are thenable, not real Promises.
      const jobs: PromiseLike<unknown>[] = [];
      const partRows = participants
        .filter((p) => p.name.trim())
        .map((p) => ({
          trip_id: tripId,
          name: p.name.trim(),
          age: p.ageMode === "age" && p.age ? Number(p.age) : null,
          age_range: p.ageMode === "range" ? p.age_range : null,
          preferences: p.preferences,
        }));
      // The inserted rows feed the post-create AI generation below.
      let insertedParticipants: Participant[] = [];
      if (partRows.length) {
        jobs.push(
          supabase
            .from("participants")
            .insert(partRows)
            .select()
            .then(({ data }) => {
              insertedParticipants = (data as Participant[] | null) ?? [];
            }),
        );
      }
      if (flights.length) {
        jobs.push(
          supabase.from("flights").insert(
            flights.map((f) => ({
              trip_id: tripId,
              direction: f.direction,
              airline: f.airline || null,
              flight_number: f.flight_number || null,
              from_airport: f.from_airport || null,
              to_airport: f.to_airport || null,
              depart_at: f.depart_at ? new Date(f.depart_at).toISOString() : null,
              arrive_at: toIso(f.arrive_at),
              from_terminal: f.from_terminal || null,
              to_terminal: f.to_terminal || null,
              seats: f.seats || null,
              baggage: f.baggage || null,
              booking_ref: f.booking_ref || null,
              notes: f.notes || null,
            })),
          ),
        );
      }
      const savedStays = stays.filter((s) => s.hotel_name.trim());
      if (savedStays.length) {
        jobs.push(
          supabase.from("stays").insert(
            savedStays.map((s) => ({
              trip_id: tripId,
              hotel_name: s.hotel_name.trim(),
              address: s.address || null,
              check_in: s.check_in || null,
              check_out: s.check_out || null,
              booking_ref: s.booking_ref || null,
              phone: s.phone || null,
              url: s.url || null,
              notes: s.notes || null,
            })),
          ),
        );
      }
      if (transfers.length) {
        jobs.push(
          supabase.from("transfers").insert(
            transfers.map((t) => ({
              trip_id: tripId,
              kind: t.kind,
              provider: t.provider || null,
              pickup_location: t.pickup_location || null,
              pickup_at: t.pickup_at ? new Date(t.pickup_at).toISOString() : null,
              dropoff_location: t.dropoff_location || null,
              return_at: toIso(t.return_at),
              booking_ref: t.booking_ref || null,
              phone: t.phone || null,
              url: t.url || null,
              notes: t.notes || null,
            })),
          ),
        );
      }
      await Promise.all(jobs);

      // ---- The trip exists from here on. Nothing below may throw: a failure
      // must never land in the catch below and invite a second "create". ----
      await afterCreate(trip as Trip, insertedParticipants, partRows, savedStays);
      navigate(`/trip/${tripId}`, { replace: true });
    } catch (e) {
      console.error(e);
      toast.error("משהו השתבש ביצירת הטיול. נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Best-effort work that needs the trip id: keep the original booking files
   * (only for drafts that survived to the insert), and — if the user left the
   * checkbox on — have the agent build suggestions + itinerary. Awaited before
   * navigating on purpose: the trip tabs load their data once on mount, so
   * content landing after navigation wouldn't show until a refresh.
   */
  const afterCreate = async (
    createdTrip: Trip,
    inserted: Participant[],
    partRows: { name: string; age: number | null; age_range: string | null; preferences: string[] }[],
    savedStays: StayDraft[],
  ) => {
    const sourceDocs = [
      ...flights.map((f) => ({ file: f.source_file, category: "flight" })),
      ...savedStays.map((s) => ({ file: s.source_file, category: "hotel" })),
      ...transfers.map((t) => ({ file: t.source_file, category: "car" })),
    ].filter((d): d is { file: File; category: string } => !!d.file);

    if (!autoGenerate && !sourceDocs.length) {
      toast.success("הטיול נוצר! ✈️");
      return;
    }

    setBuilding({
      suggestions: autoGenerate ? "running" : null,
      itinerary: autoGenerate ? "running" : null,
      docs: sourceDocs.length ? "running" : null,
    });
    const mark = (key: keyof BuildState, status: TaskStatus) =>
      setBuilding((b) => (b ? { ...b, [key]: status } : b));

    // Sequential on purpose: the storage path is `${Date.now()}-${name}`, so two
    // same-named files uploaded in the same millisecond would collide.
    const uploadDocs = async (): Promise<number> => {
      let failed = 0;
      for (const d of sourceDocs) {
        try {
          if (!user) throw new Error("not_authenticated");
          await uploadTripDocument({ userId: user.id, tripId: createdTrip.id, file: d.file, category: d.category });
        } catch (err) {
          console.error(err);
          failed += 1;
        }
      }
      if (sourceDocs.length) mark("docs", failed ? "failed" : "done");
      return failed;
    };

    // Prefer the rows as inserted; fall back to the drafts (generateContent
    // only reads name/age/age_range/preferences) if the select came back empty.
    const aiParticipants: Participant[] = inserted.length
      ? inserted
      : partRows.map((r) => ({ ...r, id: "", trip_id: createdTrip.id, notes: null, created_at: "" }));
    const runAi = async (kind: "suggestions" | "itinerary"): Promise<boolean> => {
      const res = await generateContent(createdTrip, aiParticipants, kind);
      mark(kind, res.ok ? "done" : "failed");
      return res.ok;
    };

    const [failedDocs, suggestionsOk, itineraryOk] = await Promise.all([
      uploadDocs(),
      autoGenerate ? runAi("suggestions") : Promise.resolve(true),
      autoGenerate ? runAi("itinerary") : Promise.resolve(true),
    ]);

    toast.success(autoGenerate && suggestionsOk && itineraryOk ? "הטיול נוצר והסוכן בנה המלצות ומסלול ✨" : "הטיול נוצר! ✈️");
    if (failedDocs) {
      toast.error(
        failedDocs === 1
          ? "שמירת אחד מקבצי ההזמנה המקוריים נכשלה — אפשר להעלות אותו בלשונית \"מסמכים\"."
          : `שמירת ${failedDocs} מקבצי ההזמנה המקוריים נכשלה — אפשר להעלות אותם בלשונית "מסמכים".`,
      );
    }
    if (!suggestionsOk && !itineraryOk) {
      toast.error("הסוכן לא הצליח לבנות את התוכן — אפשר ליצור אותו בלשוניות \"מומלצים\" ו\"מסלול\" עם כפתור ה-AI.");
    } else if (!suggestionsOk) {
      toast.error("ההמלצות לא נוצרו — אפשר ליצור אותן בלשונית \"מומלצים\" עם כפתור ה-AI.");
    } else if (!itineraryOk) {
      toast.error("המסלול לא נוצר — אפשר ליצור אותו בלשונית \"מסלול\" עם כפתור ה-AI.");
    }
  };

  /** Seeds the whole wizard from reviewed bookings. Everything stays local
   *  until create(); the user lands on the summary and can step back to edit. */
  const onBookingsConfirm = (r: BookingsImportResult) => {
    const dest = r.destination.trim();
    if (dest) setDestination(dest);
    if (r.startDate) setStartDate(r.startDate);
    if (r.endDate) setEndDate(r.endDate);
    if (dest && !title.trim()) setTitle(`טיול ל${dest.split(",")[0].trim()}`);

    // Skip travellers already on the list (e.g. importing a second time).
    const have = new Set(participants.map((p) => personKey(p.name)));
    const newTravellers = r.travellers.filter((t) => !have.has(personKey(t.name)));
    if (newTravellers.length) setParticipants((prev) => [...prev, ...newTravellers.map(travellerToDraft)]);

    const nf = r.bookings.filter((b) => b.docType === "flight");
    const nh = r.bookings.filter((b) => b.docType === "hotel");
    const nc = r.bookings.filter((b) => b.docType === "car");
    if (nf.length) setFlights((prev) => [...prev, ...nf.map((b) => flightDraftFromVoucher(b.data as VoucherFlightData, b.sourceFile))]);
    if (nh.length) setStays((prev) => [...prev, ...nh.map((b) => stayDraftFromVoucher(b.data as VoucherHotelData, b.sourceFile))]);
    if (nc.length) setTransfers((prev) => [...prev, ...nc.map((b) => transferDraftFromVoucher(b.data as VoucherCarData, b.sourceFile))]);
    setAutoGenerate(true);

    const parts = [
      nf.length ? countHe(nf.length, "טיסה אחת", "טיסות") : null,
      nh.length ? countHe(nh.length, "מלון אחד", "מלונות") : null,
      nc.length ? countHe(nc.length, "הזמנת רכב אחת", "הזמנות רכב") : null,
      newTravellers.length ? countHe(newTravellers.length, "נוסע אחד", "נוסעים") : null,
    ].filter((x): x is string => !!x);
    const summary = parts.length ? `מולאו ${joinHebrew(parts)}` : "פרטי הטיול מולאו";

    // Step 0 is the only step with a hard requirement (a destination). With
    // one, jump straight to the summary; without one, stay here to fill it.
    if (dest || destination.trim()) {
      setStep(3);
      toast.success(`${summary} ✨ בדוק את הסיכום — אפשר לחזור לכל שלב ולערוך.`);
    } else {
      toast.success(`${summary}. חסר יעד — מלא אותו כדי להמשיך.`);
    }
  };

  // The trip already exists while this shows — no back/cancel/create controls,
  // so it can't be created twice.
  if (building) return <BuildingView state={building} />;

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-4">
      {/* top bar */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => (step === 0 ? navigate("/") : setStep((s) => s - 1))}
          className="grid size-10 place-items-center rounded-2xl border border-border bg-card"
          aria-label="חזרה"
        >
          <ArrowRight className="size-5" />
        </button>
        <span className="text-sm font-semibold text-muted-foreground">
          שלב {step + 1} מתוך {STEPS.length}
        </span>
        <button onClick={() => navigate("/")} className="grid size-10 place-items-center rounded-2xl border border-border bg-card" aria-label="ביטול">
          <X className="size-5" />
        </button>
      </div>

      {/* progress */}
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <div className={`mt-1 text-center text-[11px] font-medium ${i === step ? "text-primary" : "text-muted-foreground"}`}>
              {s}
            </div>
          </div>
        ))}
      </div>

      {step === 0 && (
        <StepBasics
          {...{
            destination, setDestination, title, setTitle, startDate, setStartDate, endDate, setEndDate,
            tripType, setTripType, budget, setBudget, emoji, setEmoji, duration,
            isAgent, guideName, setGuideName, guidePhone, setGuidePhone,
          }}
          onImportBookings={() => setBookingsOpen(true)}
        />
      )}
      {step === 1 && (
        <StepParticipants
          participants={participants}
          setParticipants={setParticipants}
          onBulkOpen={() => setBulkOpen(true)}
        />
      )}
      {step === 2 && (
        <StepLogistics
          flights={flights}
          setFlights={setFlights}
          stays={stays}
          setStays={setStays}
          transfers={transfers}
          setTransfers={setTransfers}
          onScanVoucher={() => setVoucherOpen(true)}
        />
      )}
      {step === 3 && (
        <StepReview
          title={effectiveTitle}
          destination={destination}
          emoji={emoji}
          duration={duration}
          tripType={tripType}
          participants={participants}
          flights={flights}
          stays={stays}
          transfers={transfers}
          autoGenerate={autoGenerate}
          setAutoGenerate={setAutoGenerate}
        />
      )}

      <ImportBookings open={bookingsOpen} onClose={() => setBookingsOpen(false)} onConfirm={onBookingsConfirm} />

      <ImportParticipants
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onConfirm={(items) =>
          setParticipants((prev) => [
            ...prev,
            ...items.map((p) => ({
              name: p.name,
              ageMode: (p.age != null ? "age" : "range") as "age" | "range",
              age: p.age != null ? String(p.age) : "",
              age_range: p.age_range ?? AGE_RANGES[5],
              preferences: p.preferences,
            })),
          ])
        }
      />

      {/* No trip exists yet at this point in the flow, so the extracted data
          (including the voucher-only extras, as hidden draft fields) is staged
          locally, and the source file rides along on the draft — create()
          uploads it to trip-docs only once the trip exists. */}
      <ImportVoucher
        open={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        onConfirm={(docType: VoucherDocType, data: VoucherData, sourceFile: File | null) => {
          if (docType === "flight") {
            setFlights((prev) => [...prev, flightDraftFromVoucher(data as VoucherFlightData, sourceFile)]);
          } else if (docType === "hotel") {
            setStays((prev) => [...prev, stayDraftFromVoucher(data as VoucherHotelData, sourceFile)]);
          } else {
            setTransfers((prev) => [...prev, transferDraftFromVoucher(data as VoucherCarData, sourceFile)]);
          }
        }}
      />

      {/* bottom action */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {step < STEPS.length - 1 ? (
            <Button size="lg" className="w-full" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
              המשך
              <ArrowLeft className="size-5" />
            </Button>
          ) : (
            <Button size="lg" variant="accent" className="w-full" loading={saving} onClick={create}>
              <Check className="size-5" />
              יצירת הטיול
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Step: basics ------------------------------ */
function StepBasics(p: {
  destination: string;
  setDestination: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  tripType: string;
  setTripType: (v: string) => void;
  budget: string;
  setBudget: (v: string) => void;
  emoji: string;
  setEmoji: (v: string) => void;
  duration: number | null;
  isAgent: boolean;
  guideName: string;
  setGuideName: (v: string) => void;
  guidePhone: string;
  setGuidePhone: (v: string) => void;
  onImportBookings: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold">לאן נוסעים?</h2>
        <p className="text-sm text-muted-foreground">נתחיל מהבסיס — אפשר לשנות הכל אחר כך.</p>
      </div>

      {/* Fast path first: bookings already in hand fill almost every step. */}
      <button
        onClick={p.onImportBookings}
        className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-primary-soft/50 p-4 text-start transition active:scale-[0.99]"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Ticket className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold">יש לך כבר הזמנות?</div>
          <div className="text-xs text-muted-foreground">
            העלה כרטיסי טיסה / אישור מלון / השכרת רכב ונמלא הכל אוטומטית — יעד, תאריכים, נוסעים ולוגיסטיקה
          </div>
        </div>
      </button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>או מלא ידנית</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Field label="יעד">
        <Input value={p.destination} onChange={(e) => p.setDestination(e.target.value)} placeholder="לדוגמה: לימסול, קפריסין" />
      </Field>

      <Field label="שם הטיול (לא חובה)" hint="אם לא תמלא, ניתן שם אוטומטי לפי היעד.">
        <Input value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder="החופשה המשפחתית שלנו" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="יציאה">
          <Input
            type="date"
            value={p.startDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => p.setStartDate(e.target.value)}
          />
        </Field>
        <Field label="חזרה">
          <Input type="date" value={p.endDate} min={p.startDate || undefined} onChange={(e) => p.setEndDate(e.target.value)} />
        </Field>
      </div>
      {p.duration && p.duration > 0 && (
        <p className="-mt-2 text-sm font-medium text-primary">{p.duration} ימים של כיף 🌞</p>
      )}

      <div>
        <Label>סוג הטיול</Label>
        <div className="grid grid-cols-2 gap-2">
          {TRIP_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => p.setTripType(t.value)}
              className={`flex items-center gap-2 rounded-2xl border p-3 text-right font-semibold transition ${
                p.tripType === t.value ? "border-primary bg-primary-soft" : "border-border bg-card"
              }`}
            >
              <span className="text-2xl">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Agent-only, and only for an organized trip: a private traveler
          planning their own trip has no "guide" to name. */}
      {p.isAgent && p.tripType === "organized" && (
        <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-primary/40 bg-primary-soft/40 p-4">
          <div>
            <Label className="mb-0">מדריך הטיול</Label>
            <p className="text-xs text-muted-foreground">יופיע ללקוח עם קישור וואטסאפ ישיר.</p>
          </div>
          <Field label="שם המדריך">
            <Input value={p.guideName} onChange={(e) => p.setGuideName(e.target.value)} placeholder="לדוגמה: יוסי כהן" />
          </Field>
          <Field label="טלפון (וואטסאפ)">
            <Input
              type="tel"
              dir="ltr"
              value={p.guidePhone}
              onChange={(e) => p.setGuidePhone(e.target.value)}
              placeholder="050-1234567"
            />
          </Field>
        </div>
      )}

      <div>
        <Label>תקציב</Label>
        <Segmented options={BUDGET_LEVELS.map((b) => ({ value: b.value, label: b.label, emoji: b.emoji }))} value={p.budget} onChange={p.setBudget} />
      </div>

      <div>
        <Label>אייקון לטיול</Label>
        <div className="flex flex-wrap gap-2">
          {COVER_EMOJIS.map((em) => (
            <button
              key={em}
              onClick={() => p.setEmoji(em)}
              className={`grid size-11 place-items-center rounded-2xl border text-xl transition ${
                p.emoji === em ? "border-primary bg-primary-soft" : "border-border bg-card"
              }`}
            >
              {em}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Step: participants --------------------------- */
function StepParticipants({
  participants,
  setParticipants,
  onBulkOpen,
}: {
  participants: PartDraft[];
  setParticipants: Dispatch<SetStateAction<PartDraft[]>>;
  onBulkOpen: () => void;
}) {
  // Functional updates throughout: several chips can be toggled within one tick,
  // and reading `participants` from the closure would drop all but the last.
  const add = () =>
    setParticipants((prev) => [
      ...prev,
      { name: "", ageMode: "age", age: "", age_range: AGE_RANGES[5], preferences: [] },
    ]);
  const update = (i: number, patch: Partial<PartDraft>) =>
    setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setParticipants((prev) => prev.filter((_, idx) => idx !== i));
  const togglePref = (i: number, pref: string) =>
    setParticipants((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        const has = p.preferences.includes(pref);
        return {
          ...p,
          preferences: has ? p.preferences.filter((x) => x !== pref) : [...p.preferences, pref],
        };
      }),
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold">מי מגיע?</h2>
        <p className="text-sm text-muted-foreground">
          הגילאים וההעדפות עוזרים ל-AI להתאים המלצות. אפשר גם לדלג ולהוסיף אחר כך.
        </p>
      </div>

      {/* Bulk add first — typing a large group by hand is the slow path. */}
      <button
        onClick={onBulkOpen}
        className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-primary-soft/50 p-4 text-right transition active:scale-[0.99]"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-xl text-primary-foreground">
          <Users className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold">הוספת קבוצה בבת אחת</div>
          <div className="text-xs text-muted-foreground">
            הדבק רשימת שמות, טבלת Excel, או סרוק דרכונים
          </div>
        </div>
      </button>

      {participants.map((p, i) => (
        <Card key={i} className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Input value={p.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="שם המשתתף" className="flex-1" />
            <button onClick={() => remove(i)} className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border text-destructive" aria-label="מחיקה">
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <Segmented
              className="flex-1"
              options={[
                { value: "age", label: "גיל מדויק" },
                { value: "range", label: "טווח גילאים" },
              ]}
              value={p.ageMode}
              onChange={(v) => update(i, { ageMode: v as "age" | "range" })}
            />
            {p.ageMode === "age" ? (
              <Input type="number" min={0} max={120} value={p.age} onChange={(e) => update(i, { age: e.target.value })} placeholder="גיל" className="w-24" />
            ) : (
              <select
                value={p.age_range}
                onChange={(e) => update(i, { age_range: e.target.value })}
                className="h-12 w-28 rounded-2xl border border-input bg-card px-2 text-sm"
              >
                {AGE_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Label>העדפות</Label>
          <div className="flex flex-wrap gap-1.5">
            {PREFERENCES.map((pref) => (
              <Chip key={pref.value} active={p.preferences.includes(pref.value)} onClick={() => togglePref(i, pref.value)}>
                {pref.emoji} {pref.label}
              </Chip>
            ))}
          </div>
        </Card>
      ))}

      <Button variant="outline" size="lg" onClick={add} className="w-full">
        <Plus className="size-5" />
        הוספת משתתף
      </Button>
    </div>
  );
}

/* ----------------------------- Step: logistics ----------------------------- */
function StepLogistics({
  flights,
  setFlights,
  stays,
  setStays,
  transfers,
  setTransfers,
  onScanVoucher,
}: {
  flights: FlightDraft[];
  setFlights: Dispatch<SetStateAction<FlightDraft[]>>;
  stays: StayDraft[];
  setStays: Dispatch<SetStateAction<StayDraft[]>>;
  transfers: TransferDraft[];
  setTransfers: Dispatch<SetStateAction<TransferDraft[]>>;
  /** Opens the shared voucher-scan modal (owned by the parent, same pattern as
   *  onBulkOpen/ImportParticipants) — the returned doc type routes to whichever
   *  section it actually matches, regardless of which button opened it. */
  onScanVoucher: () => void;
}) {
  // Functional updates keep rapid edits from clobbering each other.
  const patchFlight = (i: number, patch: Partial<FlightDraft>) =>
    setFlights((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const patchStay = (i: number, patch: Partial<StayDraft>) =>
    setStays((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const patchTransfer = (i: number, patch: Partial<TransferDraft>) =>
    setTransfers((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">טיסות, לינה והעברות</h2>
        <p className="text-sm text-muted-foreground">הכול אופציונלי — מלא מה שיש לך, אפשר להשלים אחר כך.</p>
      </div>

      {/* Flights */}
      <section className="flex flex-col gap-3">
        <h3 className="font-bold">✈️ טיסות</h3>
        {flights.map((f, i) => (
          <Card key={i} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <Segmented
                className="w-48"
                options={[
                  { value: "outbound", label: "הלוך" },
                  { value: "inbound", label: "חזור" },
                ]}
                value={f.direction}
                onChange={(v) => patchFlight(i, { direction: v as "outbound" | "inbound" })}
              />
              <button onClick={() => setFlights((prev) => prev.filter((_, idx) => idx !== i))} className="text-destructive" aria-label="מחיקה">
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="חברת תעופה" value={f.airline} onChange={(e) => patchFlight(i, { airline: e.target.value })} />
              <Input placeholder="מספר טיסה" value={f.flight_number} onChange={(e) => patchFlight(i, { flight_number: e.target.value })} />
              <Input placeholder="משדה (TLV)" value={f.from_airport} onChange={(e) => patchFlight(i, { from_airport: e.target.value })} />
              <Input placeholder="לשדה" value={f.to_airport} onChange={(e) => patchFlight(i, { to_airport: e.target.value })} />
            </div>
            <Field label="המראה">
              <Input type="datetime-local" value={f.depart_at} onChange={(e) => patchFlight(i, { depart_at: e.target.value })} />
            </Field>
          </Card>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setFlights((prev) => [...prev, { direction: "outbound", airline: "", flight_number: "", from_airport: "", to_airport: "", depart_at: "" }])}
          >
            <Plus className="size-4" /> הוספת טיסה
          </Button>
          <Button variant="soft" className="flex-1" onClick={onScanVoucher}>
            <ScanLine className="size-4" /> סריקת שובר
          </Button>
        </div>
      </section>

      {/* Stays */}
      <section className="flex flex-col gap-3">
        <h3 className="font-bold">🏨 לינה</h3>
        {stays.map((s, i) => (
          <Card key={i} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <Input placeholder="שם המלון" value={s.hotel_name} onChange={(e) => patchStay(i, { hotel_name: e.target.value })} className="flex-1" />
              <button onClick={() => setStays((prev) => prev.filter((_, idx) => idx !== i))} className="text-destructive" aria-label="מחיקה">
                <Trash2 className="size-4" />
              </button>
            </div>
            <Input placeholder="כתובת" value={s.address} onChange={(e) => patchStay(i, { address: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="צ'ק אין">
                <Input type="date" value={s.check_in} onChange={(e) => patchStay(i, { check_in: e.target.value })} />
              </Field>
              <Field label="צ'ק אאוט">
                <Input type="date" value={s.check_out} onChange={(e) => patchStay(i, { check_out: e.target.value })} />
              </Field>
            </div>
            <Input placeholder="מספר הזמנה" value={s.booking_ref} onChange={(e) => patchStay(i, { booking_ref: e.target.value })} />
          </Card>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setStays((prev) => [...prev, { hotel_name: "", address: "", check_in: "", check_out: "", booking_ref: "" }])}
          >
            <Plus className="size-4" /> הוספת מלון
          </Button>
          <Button variant="soft" className="flex-1" onClick={onScanVoucher}>
            <ScanLine className="size-4" /> סריקת שובר
          </Button>
        </div>
      </section>

      {/* Transfers */}
      <section className="flex flex-col gap-3">
        <h3 className="font-bold">🚗 העברות ורכב</h3>
        {transfers.map((t, i) => (
          <Card key={i} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <select
                value={t.kind}
                onChange={(e) => patchTransfer(i, { kind: e.target.value })}
                className="h-12 flex-1 rounded-2xl border border-input bg-card px-3 text-sm"
              >
                <option value="transfer">העברה</option>
                <option value="car_rental">רכב שכור</option>
              </select>
              <button onClick={() => setTransfers((prev) => prev.filter((_, idx) => idx !== i))} className="text-destructive" aria-label="מחיקה">
                <Trash2 className="size-4" />
              </button>
            </div>
            <Input placeholder="ספק" value={t.provider} onChange={(e) => patchTransfer(i, { provider: e.target.value })} />
            <Input placeholder="נקודת איסוף" value={t.pickup_location} onChange={(e) => patchTransfer(i, { pickup_location: e.target.value })} />
            <Field label="מועד">
              <Input type="datetime-local" value={t.pickup_at} onChange={(e) => patchTransfer(i, { pickup_at: e.target.value })} />
            </Field>
          </Card>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setTransfers((prev) => [...prev, { kind: "transfer", provider: "", pickup_location: "", pickup_at: "" }])}
          >
            <Plus className="size-4" /> הוספת העברה / רכב
          </Button>
          <Button variant="soft" className="flex-1" onClick={onScanVoucher}>
            <ScanLine className="size-4" /> סריקת שובר
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------- Step: review ------------------------------ */
function StepReview(p: {
  title: string;
  destination: string;
  emoji: string;
  duration: number | null;
  tripType: string;
  participants: PartDraft[];
  flights: FlightDraft[];
  stays: StayDraft[];
  transfers: TransferDraft[];
  autoGenerate: boolean;
  setAutoGenerate: (v: boolean) => void;
}) {
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold">כמעט שם! 🎉</h2>
        <p className="text-sm text-muted-foreground">בדוק שהכול נכון ולחץ ליצירת הטיול.</p>
      </div>
      <Card className="flex items-center gap-4 p-4">
        <div className="grid size-16 place-items-center rounded-2xl bg-gradient-sea text-3xl">
          {destinationFlag(p.destination) ?? p.emoji}
        </div>
        <div>
          <div className="text-lg font-bold">{p.title || "טיול חדש"}</div>
          <div className="text-sm text-muted-foreground">{p.destination}</div>
        </div>
      </Card>
      <Card className="p-4">
        {row("משך", p.duration ? `${p.duration} ימים` : "לא נקבע")}
        {row("משתתפים", p.participants.filter((x) => x.name.trim()).length.toString())}
        {row("טיסות", p.flights.length.toString())}
        {row("מלונות", p.stays.filter((x) => x.hotel_name.trim()).length.toString())}
        {row("העברות", p.transfers.length.toString())}
      </Card>
      <Card className="flex items-start gap-3 p-4">
        <Checkbox checked={p.autoGenerate} onChange={p.setAutoGenerate} />
        <button type="button" onClick={() => p.setAutoGenerate(!p.autoGenerate)} className="flex-1 text-start">
          <div className="font-semibold">הסוכן יבנה המלצות ומסלול אוטומטית ✨</div>
          <div className="text-xs text-muted-foreground">
            מיד אחרי היצירה — אטרקציות, מסעדות ומסלול יומי מותאמים למשתתפים. לוקח כחצי דקה.
          </div>
        </button>
      </Card>
      {!p.autoGenerate && (
        <p className="text-center text-sm text-muted-foreground">
          אחרי היצירה תוכל להפעיל את ה-AI כדי לקבל אטרקציות, מסלול יומי וצ'קליסט מותאמים ✨
        </p>
      )}
    </div>
  );
}

/* ------------------------- Post-create: agent building ------------------------- */
function BuildingView({ state }: { state: BuildState }) {
  const lines: { key: keyof BuildState; running: string; done: string; failed: string }[] = [
    { key: "suggestions", running: "יוצר המלצות…", done: "ההמלצות מוכנות", failed: "ההמלצות לא נוצרו — אפשר ליצור אחר כך" },
    { key: "itinerary", running: "בונה מסלול יומי…", done: "המסלול היומי מוכן", failed: "המסלול לא נוצר — אפשר ליצור אחר כך" },
    { key: "docs", running: "שומר את קבצי ההזמנה המקוריים…", done: "קבצי ההזמנה נשמרו במסמכים", failed: "חלק מהקבצים לא נשמרו" },
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-4 text-center">
      <Spinner className="size-10" />
      <div>
        <h2 className="text-xl font-bold">הטיול נוצר! הסוכן משלים את הפרטים</h2>
        <p className="text-sm text-muted-foreground">עוד רגע ונעבור לטיול — אין צורך לעשות כלום.</p>
      </div>
      <Card className="flex w-full flex-col gap-3 p-4 text-start">
        {lines
          .filter((l) => state[l.key])
          .map((l) => {
            const s = state[l.key];
            return (
              <div key={l.key} className="flex items-center gap-3 text-sm">
                {s === "running" && <Spinner className="size-5" />}
                {s === "done" && <CircleCheck className="size-5 text-primary" />}
                {s === "failed" && <CircleAlert className="size-5 text-destructive" />}
                <span className={s === "failed" ? "text-destructive" : s === "done" ? "font-semibold" : "text-muted-foreground"}>
                  {s === "running" ? l.running : s === "done" ? l.done : l.failed}
                </span>
              </div>
            );
          })}
      </Card>
    </div>
  );
}
