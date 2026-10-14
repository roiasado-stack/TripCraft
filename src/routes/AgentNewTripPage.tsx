import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, FileUp, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button, Field, GroupedList, Input } from "@/components/ui";
import { ImportBookings, personKey, type BookingsImportResult } from "@/components/ImportBookings";
import { insertTripWithDrafts, uploadSourceDocs } from "@/lib/create-trip";
import {
  bookingsToDrafts,
  collectSourceDocs,
  countHe,
  joinHebrew,
  travellerToDraft,
  type FlightDraft,
  type PartDraft,
  type StayDraft,
  type TransferDraft,
} from "@/lib/trip-drafts";
import { AGE_RANGES } from "@/lib/trip-options";
import { normalizePhone } from "@/lib/whatsapp";

const STEP_LABELS = ["מסמכים", "בדיקה", "שליחה"];

/** A trip-limit hit comes back from the trips trigger (migration 022) as this message. */
function isTripLimit(e: unknown): boolean {
  return typeof e === "object" && e !== null && String((e as { message?: string }).message).includes("agent_trip_limit_reached");
}

/**
 * "New trip from documents" (agency beta, phase 2): 1) the documents, through
 * the existing ImportBookings scan; 2) one review screen with the client;
 * 3) /agent/send/:id. Creation goes through the same insert as the wizard.
 */
export default function AgentNewTripPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1>(0);
  const [importOpen, setImportOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [travellers, setTravellers] = useState<PartDraft[]>([]);
  const [flights, setFlights] = useState<FlightDraft[]>([]);
  const [stays, setStays] = useState<StayDraft[]>([]);
  const [transfers, setTransfers] = useState<TransferDraft[]>([]);

  const phoneInvalid = clientPhone.trim() !== "" && !normalizePhone(clientPhone);

  /** Scanned and reviewed bookings → this screen's drafts. A second import adds to the first. */
  const onImported = (r: BookingsImportResult) => {
    const dest = r.destination.trim();
    if (dest && !destination.trim()) setDestination(dest);
    if (r.startDate && !startDate) setStartDate(r.startDate);
    if (r.endDate && !endDate) setEndDate(r.endDate);
    if (dest && !title.trim()) setTitle(`טיול ל${dest.split(",")[0].trim()}`);

    const have = new Set(travellers.map((t) => personKey(t.name)));
    const fresh = r.travellers.filter((t) => !have.has(personKey(t.name)));
    if (fresh.length) setTravellers((prev) => [...prev, ...fresh.map(travellerToDraft)]);
    const d = bookingsToDrafts(r);
    setFlights((prev) => [...prev, ...d.flights]);
    setStays((prev) => [...prev, ...d.stays]);
    setTransfers((prev) => [...prev, ...d.transfers]);
    setStep(1);
  };

  const bookingsSummary = joinHebrew(
    [
      flights.length ? countHe(flights.length, "טיסה אחת", "טיסות") : null,
      stays.length ? countHe(stays.length, "מלון אחד", "מלונות") : null,
      transfers.length ? countHe(transfers.length, "הזמנת רכב אחת", "הזמנות רכב") : null,
    ].filter((x): x is string => !!x),
  );

  const create = async () => {
    if (!user) return;
    if (!destination.trim()) {
      toast.error("צריך יעד לטיול");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error("תאריך החזרה מוקדם מתאריך היציאה");
      return;
    }
    if (phoneInvalid) {
      toast.error("מספר הטלפון של הלקוח לא תקין");
      return;
    }
    setSaving(true);
    let tripId: string;
    let failedChildren = 0;
    let savedStays: StayDraft[] = [];
    try {
      const res = await insertTripWithDrafts({
        userId: user.id,
        fields: {
          title: title.trim() || `טיול ל${destination.split(",")[0].trim()}`,
          destination: destination.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          trip_type: "family",
          budget_level: "mid",
          cover_emoji: "🌴",
        },
        participants: travellers,
        flights,
        stays,
        transfers,
      });
      tripId = res.trip.id;
      failedChildren = res.failedChildren;
      savedStays = res.savedStays;
    } catch (e) {
      console.error(e);
      toast.error(
        isTripLimit(e)
          ? "הגעת למכסת הטיולים הפעילים בחשבון. אפשר למחוק טיול ישן או לפנות אלינו."
          : "משהו השתבש ביצירת הטיול. נסו שוב.",
      );
      setSaving(false);
      return;
    }

    // ---- The trip exists from here on: report problems, never offer "create" again. ----
    const name = clientName.trim();
    const phone = clientPhone.trim();
    const [{ error: clientError }, failedDocs] = await Promise.all([
      name || phone
        ? supabase.from("trip_clients").insert({ trip_id: tripId, client_name: name || null, client_phone: phone || null })
        : Promise.resolve({ error: null }),
      uploadSourceDocs(user.id, tripId, collectSourceDocs(flights, savedStays, transfers)),
    ]);
    toast.success("הטיול נוצר ✈️");
    if (clientError) toast.error("פרטי הלקוח לא נשמרו — אפשר להוסיף אותם במסך השליחה.");
    if (failedChildren) toast.error("חלק מההזמנות או הנוסעים לא נשמרו — כדאי לבדוק בטיול.");
    if (failedDocs)
      toast.error(
        failedDocs === 1
          ? "שמירת אחד מקבצי ההזמנה נכשלה — אפשר להעלות אותו בלשונית \"מסמכים\"."
          : `שמירת ${failedDocs} מקבצי ההזמנה נכשלה — אפשר להעלות אותם בלשונית "מסמכים".`,
      );
    navigate(`/agent/send/${tripId}`, { replace: true });
  };

  const renameTraveller = (i: number, name: string) =>
    setTravellers((prev) => prev.map((t, idx) => (idx === i ? { ...t, name } : t)));
  const removeTraveller = (i: number) => setTravellers((prev) => prev.filter((_, idx) => idx !== i));
  const addTraveller = () =>
    setTravellers((prev) => [...prev, { name: "", ageMode: "age", age: "", age_range: AGE_RANGES[5], preferences: [] }]);

  const fieldRow = "flex min-h-12 items-center gap-3 px-4";
  const fieldInput = "type-body min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted-foreground";

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-32 pt-4">
      {/* top bar */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => (step === 1 ? setStep(0) : navigate("/agent"))}
          className="-ms-2 grid size-11 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
          aria-label="חזרה"
        >
          <ArrowRight className="size-6" />
        </button>
        <span className="type-footnote font-semibold text-muted-foreground">
          שלב {step + 1} מתוך {STEP_LABELS.length}
        </span>
        <button
          onClick={() => navigate("/agent")}
          className="-me-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
          aria-label="ביטול"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="mb-6 flex gap-1.5">
        {STEP_LABELS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <div
              className={`type-footnote mt-1 min-w-0 truncate text-center ${i === step ? "font-semibold text-primary" : "text-muted-foreground"}`}
            >
              {s}
            </div>
          </div>
        ))}
      </div>

      {step === 0 ? (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="type-large-title">טיול חדש מהמסמכים</h1>
            <p className="type-body mt-1 text-muted-foreground">
              כרטיסי טיסה, אישור מלון, השכרת רכב — PDF או צילום. נזהה יעד, תאריכים ונוסעים, ותבדקו לפני שהטיול נוצר.
            </p>
          </div>
          <Button size="lg" className="w-full" onClick={() => setImportOpen(true)}>
            <FileUp className="size-5" />
            {flights.length + stays.length + transfers.length ? "הוספת מסמכים" : "בחירת מסמכים"}
          </Button>
          {flights.length + stays.length + transfers.length > 0 && (
            <Button variant="soft" size="lg" className="w-full" onClick={() => setStep(1)}>
              המשך לבדיקה ({bookingsSummary})
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="type-large-title">בדיקה אחרונה</h1>
            {bookingsSummary && <p className="type-body mt-1 text-muted-foreground">זוהו {bookingsSummary}.</p>}
          </div>

          <GroupedList title="הלקוח">
            <label className={fieldRow}>
              <span className="type-body w-20 shrink-0">שם</span>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="לדוגמה: משפחת כהן"
                maxLength={120}
                className={fieldInput}
              />
            </label>
            <label className={fieldRow}>
              <span className="type-body w-20 shrink-0">טלפון</span>
              <input
                type="tel"
                dir="ltr"
                inputMode="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="050-1234567"
                maxLength={40}
                className={`${fieldInput} text-end`}
                aria-invalid={phoneInvalid}
              />
            </label>
          </GroupedList>
          <p className={`type-footnote -mt-4 px-4 ${phoneInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {phoneInvalid ? "המספר לא נראה תקין. לדוגמה: 050-1234567" : "רק אתם רואים את פרטי הלקוח — לא הנוסעים ולא דף הטיול."}
          </p>

          <section className="flex flex-col gap-3">
            <Field label="שם הטיול">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="טיול לרומא" />
            </Field>
            <Field label="יעד" hint={destination.trim() ? undefined : "לא זוהה יעד מהמסמכים — צריך למלא."}>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="לדוגמה: רומא, איטליה" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="יציאה">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="חזרה">
                <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
          </section>

          <GroupedList title={travellers.length ? `נוסעים (${travellers.length})` : "נוסעים"}>
            {travellers.map((t, i) => (
              <div key={i} className="flex min-h-12 items-center gap-2 ps-4 pe-1">
                <input
                  value={t.name}
                  onChange={(e) => renameTraveller(i, e.target.value)}
                  placeholder="שם הנוסע"
                  dir="auto"
                  aria-label="שם הנוסע"
                  className={fieldInput}
                />
                <button
                  type="button"
                  onClick={() => removeTraveller(i)}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-destructive transition-colors active:bg-muted/70"
                  aria-label={`הסרת ${t.name || "הנוסע"}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTraveller}
              className="type-body flex min-h-12 w-full items-center gap-3 px-4 text-start text-primary transition-colors active:bg-muted/70"
            >
              <Plus className="size-5" />
              הוספת נוסע
            </button>
          </GroupedList>
        </div>
      )}

      <ImportBookings open={importOpen} onClose={() => setImportOpen(false)} onConfirm={onImported} context="agent" />

      {step === 1 && (
        <div className="material safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-separator px-4 py-3">
          <div className="mx-auto max-w-lg">
            <Button size="lg" variant="accent" className="w-full" loading={saving} disabled={!destination.trim()} onClick={create}>
              <Check className="size-5" />
              יצירת הטיול
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
