import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button, Card, Chip, Field, Input, Label, Segmented } from "@/components/ui";
import { ImportParticipants } from "@/components/ImportParticipants";
import {
  AGE_RANGES,
  BUDGET_LEVELS,
  COVER_EMOJIS,
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
type FlightDraft = {
  direction: "outbound" | "inbound";
  airline: string;
  flight_number: string;
  from_airport: string;
  to_airport: string;
  depart_at: string;
};
type StayDraft = { hotel_name: string; address: string; check_in: string; check_out: string; booking_ref: string };
type TransferDraft = { kind: string; provider: string; pickup_location: string; pickup_at: string };

const STEPS = ["יעד", "משתתפים", "לוגיסטיקה", "סיכום"];

export default function WizardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // step 0
  const [destination, setDestination] = useState("");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tripType, setTripType] = useState<string>("family");
  const [budget, setBudget] = useState<string>("mid");
  const [emoji, setEmoji] = useState<string>("🌴");

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
        })
        .select()
        .single();
      if (error || !trip) throw error;
      const tripId = trip.id;

      // Supabase query builders are thenable, not real Promises.
      const jobs: PromiseLike<unknown>[] = [];
      if (participants.length) {
        jobs.push(
          supabase.from("participants").insert(
            participants
              .filter((p) => p.name.trim())
              .map((p) => ({
                trip_id: tripId,
                name: p.name.trim(),
                age: p.ageMode === "age" && p.age ? Number(p.age) : null,
                age_range: p.ageMode === "range" ? p.age_range : null,
                preferences: p.preferences,
              })),
          ),
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
            })),
          ),
        );
      }
      if (stays.length) {
        jobs.push(
          supabase.from("stays").insert(
            stays
              .filter((s) => s.hotel_name.trim())
              .map((s) => ({
                trip_id: tripId,
                hotel_name: s.hotel_name.trim(),
                address: s.address || null,
                check_in: s.check_in || null,
                check_out: s.check_out || null,
                booking_ref: s.booking_ref || null,
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
            })),
          ),
        );
      }
      await Promise.all(jobs);
      toast.success("הטיול נוצר! ✈️");
      navigate(`/trip/${tripId}`, { replace: true });
    } catch (e) {
      console.error(e);
      toast.error("משהו השתבש ביצירת הטיול. נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

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
          {...{ destination, setDestination, title, setTitle, startDate, setStartDate, endDate, setEndDate, tripType, setTripType, budget, setBudget, emoji, setEmoji, duration }}
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
        />
      )}

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
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold">לאן נוסעים?</h2>
        <p className="text-sm text-muted-foreground">נתחיל מהבסיס — אפשר לשנות הכל אחר כך.</p>
      </div>

      <Field label="יעד">
        <Input value={p.destination} onChange={(e) => p.setDestination(e.target.value)} placeholder="לדוגמה: לימסול, קפריסין" />
      </Field>

      <Field label="שם הטיול (לא חובה)" hint="אם לא תמלא, ניתן שם אוטומטי לפי היעד.">
        <Input value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder="החופשה המשפחתית שלנו" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="יציאה">
          <Input type="date" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} />
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
}: {
  flights: FlightDraft[];
  setFlights: Dispatch<SetStateAction<FlightDraft[]>>;
  stays: StayDraft[];
  setStays: Dispatch<SetStateAction<StayDraft[]>>;
  transfers: TransferDraft[];
  setTransfers: Dispatch<SetStateAction<TransferDraft[]>>;
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
        <Button variant="outline" onClick={() => setFlights((prev) => [...prev, { direction: "outbound", airline: "", flight_number: "", from_airport: "", to_airport: "", depart_at: "" }])}>
          <Plus className="size-4" /> הוספת טיסה
        </Button>
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
        <Button variant="outline" onClick={() => setStays((prev) => [...prev, { hotel_name: "", address: "", check_in: "", check_out: "", booking_ref: "" }])}>
          <Plus className="size-4" /> הוספת מלון
        </Button>
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
        <Button variant="outline" onClick={() => setTransfers((prev) => [...prev, { kind: "transfer", provider: "", pickup_location: "", pickup_at: "" }])}>
          <Plus className="size-4" /> הוספת העברה / רכב
        </Button>
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
        <div className="grid size-16 place-items-center rounded-2xl bg-gradient-sea text-3xl">{p.emoji}</div>
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
      <p className="text-center text-sm text-muted-foreground">
        אחרי היצירה תוכל להפעיל את ה-AI כדי לקבל אטרקציות, מסלול יומי וצ'קליסט מותאמים ✨
      </p>
    </div>
  );
}
