import { useRef, useState } from "react";
import { AlertTriangle, Clock, FilePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { mapInvokeError } from "@/lib/ai";
import { useToast } from "@/hooks/use-toast";
import { Badge, Button, Card, Field, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AGE_RANGES, prefLabel } from "@/lib/trip-options";
import type { ParsedParticipant } from "@/lib/import-participants";
import {
  blankCar,
  blankFlight,
  blankHotel,
  type VoucherCarData,
  type VoucherData,
  type VoucherDocType,
  type VoucherFlightData,
  type VoucherHotelData,
} from "@/components/ImportVoucher";

/** Reads a File as a base64 data payload for the vision endpoint. Same shape as
 *  the copies in ImportVoucher/ImportParticipants. */
function fileToBase64(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({ media_type: file.type || "image/jpeg", data: result.slice(comma + 1) });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_FILES = 8;
const CONCURRENCY = 3;

export type PassengerType = "adult" | "child" | "infant";

/** One traveller as the `voucher` extraction returns it (already sanitized server-side). */
type ScannedPassenger = {
  name: string;
  type: PassengerType | null;
  birth_date: string | null;
  preferences: string[];
};

export type ImportedBooking = { docType: VoucherDocType; data: VoucherData; sourceFile: File };
/** Same shape the passport scan hands the wizard, plus the detected passenger type. */
export type BookingTraveller = ParsedParticipant & { type: PassengerType | null };
export type BookingsImportResult = {
  destination: string;
  startDate: string;
  endDate: string;
  travellers: BookingTraveller[];
  bookings: ImportedBooking[];
};

type ScanStatus = "pending" | "scanning" | "done" | "unknown" | "error";
type ScanItem = {
  id: number;
  file: File;
  status: ScanStatus;
  booking: { docType: VoucherDocType; data: VoucherData } | null;
  destination: string | null;
  passengers: ScannedPassenger[];
  /** Removed by the user in the review view — kept so ids stay stable. */
  removed: boolean;
};
type TravellerDraft = {
  /** Normalized name, fixed at first sight — used for de-duplication only. */
  key: string;
  name: string;
  type: PassengerType | null;
  birth_date: string | null;
  preferences: string[];
};

/**
 * Case-, whitespace-, punctuation-, diacritic- and word-order-insensitive key
 * for a person's name, so "Roi Cohen" on the flight and "COHEN ROI" on the
 * hotel collapse into one traveller. Strips Latin combining marks and Hebrew
 * niqqud/cantillation. Exported so the wizard can skip travellers it already has.
 */
export function personKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Exact age on `onDate` (YYYY-MM-DD, falls back to today) for a YYYY-MM-DD birth date. */
function ageOn(birth: string, onDate: string): number | null {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : todayIso();
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ry, rm, rd] = ref.split("-").map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

const TYPE_LABEL: Record<PassengerType, string> = { adult: "מבוגר", child: "ילד", infant: "תינוק" };
const DOC_LABEL: Record<VoucherDocType, string> = { flight: "טיסה", hotel: "מלון", car: "רכב / העברה" };
const DOC_EMOJI: Record<VoucherDocType, string> = { flight: "✈️", hotel: "🏨", car: "🚗" };

/** Date-part (YYYY-MM-DD) of a server date/datetime. The `voucher` extraction
 *  returns wall-clock values without an offset, so slicing is exact. */
function datePart(s: string | null | undefined): string | null {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
/** "YYYY-MM-DD[THH:MM…]" → "DD/MM[ HH:MM]" without any timezone conversion. */
function shortDate(s: string | null | undefined): string | null {
  const d = datePart(s);
  if (!d || !s) return null;
  const dm = `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const time = s.match(/T(\d{2}:\d{2})/)?.[1];
  return time ? `${dm} ${time}` : dm;
}

function bookingDates(b: { docType: VoucherDocType; data: VoucherData }): string[] {
  const raw =
    b.docType === "flight"
      ? [(b.data as VoucherFlightData).depart_at, (b.data as VoucherFlightData).arrive_at]
      : b.docType === "hotel"
        ? [(b.data as VoucherHotelData).check_in, (b.data as VoucherHotelData).check_out]
        : [(b.data as VoucherCarData).pickup_at, (b.data as VoucherCarData).return_at];
  return raw.map(datePart).filter((d): d is string => !!d);
}

/** Start = earliest date across all bookings, end = latest. */
function pickDates(items: ScanItem[]): { start: string; end: string } {
  const all = items.flatMap((i) => (i.booking ? bookingDates(i.booking) : [])).sort();
  return { start: all[0] ?? "", end: all[all.length - 1] ?? "" };
}

/** Most common non-null destination; on a tie, one backed by a hotel beats a
 *  car booking, which beats a flight (the hotel's city is the most direct signal). */
function pickDestination(items: ScanItem[]): string {
  const priority: Record<VoucherDocType, number> = { hotel: 2, car: 1, flight: 0 };
  const tally = new Map<string, { count: number; pri: number }>();
  for (const it of items) {
    if (!it.destination || !it.booking) continue;
    const cur = tally.get(it.destination) ?? { count: 0, pri: -1 };
    tally.set(it.destination, { count: cur.count + 1, pri: Math.max(cur.pri, priority[it.booking.docType]) });
  }
  const best = [...tally.entries()].sort((a, b) => b[1].count - a[1].count || b[1].pri - a[1].pri)[0];
  return best?.[0] ?? "";
}

function mergeTravellers(prev: TravellerDraft[], incoming: ScannedPassenger[], dismissed: Set<string>): TravellerDraft[] {
  const out = prev.map((t) => ({ ...t, preferences: [...t.preferences] }));
  for (const p of incoming) {
    const key = personKey(p.name);
    if (!key || dismissed.has(key)) continue;
    const existing = out.find((t) => t.key === key);
    if (existing) {
      if (!existing.type && p.type) existing.type = p.type;
      if (!existing.birth_date && p.birth_date) existing.birth_date = p.birth_date;
      existing.preferences = [...new Set([...existing.preferences, ...p.preferences])];
    } else {
      out.push({
        key,
        name: p.name,
        type: p.type,
        birth_date: p.birth_date,
        preferences: [...new Set(p.preferences)],
      });
    }
  }
  return out;
}

/** Client-side guard over the (already server-sanitized) passengers array. */
function readPassengers(raw: unknown): ScannedPassenger[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const p = (r ?? {}) as Record<string, unknown>;
      const name = typeof p.name === "string" ? p.name.trim() : "";
      if (!name) return null;
      const type = p.type === "adult" || p.type === "child" || p.type === "infant" ? p.type : null;
      const birth_date =
        typeof p.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date) ? p.birth_date : null;
      const preferences = Array.isArray(p.preferences)
        ? p.preferences.filter((x): x is string => typeof x === "string")
        : [];
      return { name, type, birth_date, preferences };
    })
    .filter((p): p is ScannedPassenger => p !== null);
}

function BookingSummary({ booking }: { booking: { docType: VoucherDocType; data: VoucherData } }) {
  let title: string;
  let meta: (string | null)[];
  if (booking.docType === "flight") {
    const d = booking.data as VoucherFlightData;
    title = [d.airline, d.flight_number].filter(Boolean).join(" ") || "טיסה";
    meta = [
      d.direction === "inbound" ? "חזור" : "הלוך",
      d.from_airport && d.to_airport ? `${d.from_airport}→${d.to_airport}` : d.from_airport || d.to_airport,
      shortDate(d.depart_at),
    ];
  } else if (booking.docType === "hotel") {
    const d = booking.data as VoucherHotelData;
    title = d.hotel_name.trim() || "מלון (ללא שם — להשלים בשלב הלוגיסטיקה)";
    const range = [shortDate(d.check_in), shortDate(d.check_out)].filter(Boolean).join(" – ");
    meta = [range || null];
  } else {
    const d = booking.data as VoucherCarData;
    title = d.provider || "רכב / העברה";
    meta = [d.pickup_location, shortDate(d.pickup_at)];
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold">{title}</div>
      <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        {meta.filter(Boolean).map((m, i) => (
          <span key={i}>{i > 0 ? `· ${m}` : m}</span>
        ))}
      </div>
    </div>
  );
}

export function ImportBookings({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the reviewed trip basics, travellers and bookings (with their
   *  original files). Nothing is written by this component — the caller stages it. */
  onConfirm: (result: BookingsImportResult) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  // Bumped on reset so a scan still in flight from a closed session can't
  // flip the `scanning` flag of a new one.
  const session = useRef(0);

  const [view, setView] = useState<"scan" | "review">("scan");
  const [items, setItems] = useState<ScanItem[]>([]);
  const [scanning, setScanning] = useState(false);

  // review state
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [touched, setTouched] = useState({ destination: false, dates: false });
  const [travellers, setTravellers] = useState<TravellerDraft[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merged, setMerged] = useState<Set<number>>(new Set());

  const reset = () => {
    session.current += 1;
    setView("scan");
    setItems([]);
    setScanning(false);
    setDestination("");
    setStartDate("");
    setEndDate("");
    setTouched({ destination: false, dates: false });
    setTravellers([]);
    setDismissed(new Set());
    setMerged(new Set());
  };
  const close = () => {
    reset();
    onClose();
  };

  const patchItem = (id: number, patch: Partial<ScanItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  /** One file = one booking = one `voucher` call. Never throws. */
  const scanOne = async (item: ScanItem): Promise<{ recognized: boolean; error?: string }> => {
    patchItem(item.id, { status: "scanning" });
    try {
      const image = await fileToBase64(item.file);
      const { data, error } = await supabase.functions.invoke("generate", {
        body: { kind: "voucher", images: [image] },
      });
      if (error) {
        patchItem(item.id, { status: "error" });
        return { recognized: false, error: await mapInvokeError(error) };
      }
      const res = data as {
        ok?: boolean;
        doc_type?: string;
        data?: Record<string, unknown> | null;
        destination?: unknown;
        passengers?: unknown;
      };
      if (!res?.ok || !res.data || (res.doc_type !== "flight" && res.doc_type !== "hotel" && res.doc_type !== "car")) {
        patchItem(item.id, { status: "unknown" });
        return { recognized: false };
      }
      const docType = res.doc_type;
      const bookingData: VoucherData =
        docType === "flight"
          ? { ...blankFlight, ...(res.data as Partial<VoucherFlightData>) }
          : docType === "hotel"
            ? { ...blankHotel, ...(res.data as Partial<VoucherHotelData>) }
            : { ...blankCar, ...(res.data as Partial<VoucherCarData>) };
      patchItem(item.id, {
        status: "done",
        booking: { docType, data: bookingData },
        destination: typeof res.destination === "string" && res.destination.trim() ? res.destination.trim() : null,
        passengers: readPassengers(res.passengers),
      });
      return { recognized: true };
    } catch {
      patchItem(item.id, { status: "error" });
      return { recognized: false, error: "unknown" };
    }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    if (!picked.length) return;
    const room = MAX_FILES - items.length;
    if (room <= 0) {
      toast.error(`אפשר לסרוק עד ${MAX_FILES} קבצים.`);
      return;
    }
    if (picked.length > room) toast.error(`אפשר לסרוק עד ${MAX_FILES} קבצים — נסרקים רק ${room} הראשונים.`);
    const batch: ScanItem[] = picked.slice(0, room).map((file) => ({
      id: nextId.current++,
      file,
      status: "pending",
      booking: null,
      destination: null,
      passengers: [],
      removed: false,
    }));
    setItems((prev) => [...prev, ...batch]);

    const mySession = session.current;
    setScanning(true);
    const results: { recognized: boolean; error?: string }[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const item = batch[cursor++];
        results.push(await scanOne(item));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
    if (mySession !== session.current) return; // modal closed meanwhile
    setScanning(false);

    const recognized = results.filter((r) => r.recognized).length;
    const errors = results.map((r) => r.error).filter(Boolean);
    if (errors.includes("not_deployed")) {
      toast.error("סריקת שוברים דורשת הפעלת ה-AI. ראה README.");
    } else if (errors.includes("daily_cap_reached")) {
      toast.error("הגעת למכסת ה-AI היומית — נסה שוב מחר.");
    } else if (recognized === 0) {
      toast.error("לא זוהו הזמנות בקבצים שנבחרו — נסה קבצים ברורים יותר.");
    } else if (recognized < batch.length) {
      toast.success(`זוהו ${recognized} מתוך ${batch.length} קבצים 🧾`);
    } else {
      toast.success(recognized === 1 ? "ההזמנה זוהתה 🧾" : `זוהו ${recognized} הזמנות 🧾`);
    }
  };

  const recognizedItems = (list: ScanItem[]) => list.filter((i) => i.status === "done" && i.booking && !i.removed);
  const active = recognizedItems(items);

  /** Re-derives whatever the user hasn't edited yet from the current bookings. */
  const refreshBasics = (list: ScanItem[]) => {
    const rec = recognizedItems(list);
    if (!touched.destination) setDestination(pickDestination(rec));
    if (!touched.dates) {
      const { start, end } = pickDates(rec);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const enterReview = () => {
    refreshBasics(items);
    // Only merge passengers from bookings not merged before, so edits and
    // removals made on an earlier visit to the review survive "add more files".
    const fresh = active.filter((i) => !merged.has(i.id));
    setTravellers((prev) => mergeTravellers(prev, fresh.flatMap((i) => i.passengers), dismissed));
    setMerged((prev) => new Set([...prev, ...fresh.map((i) => i.id)]));
    setView("review");
  };

  const removeBooking = (id: number) => {
    const next = items.map((it) => (it.id === id ? { ...it, removed: true } : it));
    setItems(next);
    refreshBasics(next);
  };
  const removeScanItem = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));

  const renameTraveller = (key: string, name: string) =>
    setTravellers((prev) => prev.map((t) => (t.key === key ? { ...t, name } : t)));
  const removeTraveller = (key: string) => {
    setTravellers((prev) => prev.filter((t) => t.key !== key));
    setDismissed((prev) => new Set([...prev, key]));
  };

  const confirm = () => {
    if (!active.length) return;
    if (startDate && endDate && endDate < startDate) {
      toast.error("תאריך החזרה מוקדם מתאריך היציאה");
      return;
    }
    const out: BookingTraveller[] = travellers
      .filter((t) => t.name.trim())
      .map((t) => {
        // Exact age only from a printed birth date; an infant marker alone is
        // enough for the 0-3 range. Adults/children without a birth date stay
        // unset — a child (2-11) spans several ranges, so any pick would be a guess.
        const age = t.birth_date ? ageOn(t.birth_date, startDate) : null;
        return {
          name: t.name.trim(),
          age,
          age_range: age == null && t.type === "infant" ? AGE_RANGES[0] : null,
          preferences: t.preferences,
          type: t.type,
        };
      });
    onConfirm({
      destination: destination.trim(),
      startDate,
      endDate,
      travellers: out,
      bookings: active.map((i) => ({ docType: i.booking!.docType, data: i.booking!.data, sourceFile: i.file })),
    });
    close();
  };

  const statusLine = (it: ScanItem) => {
    switch (it.status) {
      case "pending":
        return { icon: <Clock className="size-4 text-muted-foreground" />, text: "ממתין…", tone: "text-muted-foreground" };
      case "scanning":
        return { icon: <Loader2 className="size-4 animate-spin text-primary" />, text: "סורק…", tone: "text-primary" };
      case "done":
        return {
          icon: <span className="text-base leading-none">{DOC_EMOJI[it.booking!.docType]}</span>,
          text: `זוהה: ${DOC_LABEL[it.booking!.docType]}`,
          tone: "text-primary",
        };
      case "unknown":
        return { icon: <AlertTriangle className="size-4 text-destructive" />, text: "לא זוהה — ידולג", tone: "text-destructive" };
      default:
        return { icon: <AlertTriangle className="size-4 text-destructive" />, text: "הסריקה נכשלה — ידולג", tone: "text-destructive" };
    }
  };

  const skipped = items.filter((i) => i.status === "unknown" || i.status === "error").length;

  return (
    <Modal open={open} onClose={close} title={view === "scan" ? "יצירת טיול מהזמנות" : "בדיקה לפני מילוי"}>
      {view === "scan" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            בחר את אישורי ההזמנה שלך — כרטיסי טיסה, אישור מלון, השכרת רכב. נזהה יעד, תאריכים, נוסעים ופרטי
            הזמנה, ותוכל לבדוק הכל לפני שנמלא את הטיול.
          </p>

          <Button
            size="lg"
            variant={items.length ? "outline" : "primary"}
            loading={scanning}
            disabled={items.length >= MAX_FILES}
            onClick={() => fileRef.current?.click()}
          >
            {items.length ? <FilePlus className="size-5" /> : <Sparkles className="size-5" />}
            {items.length ? "הוספת קבצים" : "בחירת קבצים"}
          </Button>
          {/* No `capture` attribute: see DocumentsTab.tsx for why. */}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onFiles} />
          <p className="-mt-1 text-center text-xs text-muted-foreground">
            כל קובץ הוא הזמנה אחת (PDF של כמה עמודים — עדיין הזמנה אחת). עד {MAX_FILES} קבצים. דורש הפעלת AI.
          </p>

          {items.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {items.map((it) => {
                const s = statusLine(it);
                return (
                  <div
                    key={it.id}
                    className={cn("flex items-center gap-2 rounded-2xl border border-border p-2.5", it.removed && "opacity-50")}
                  >
                    <div className="grid size-7 shrink-0 place-items-center">{s.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold" dir="auto">
                        {it.file.name}
                      </div>
                      <div className={cn("text-xs font-medium", s.tone)}>{it.removed ? "הוסר" : s.text}</div>
                    </div>
                    {it.status !== "pending" && it.status !== "scanning" && (
                      <button
                        onClick={() => removeScanItem(it.id)}
                        className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground"
                        aria-label="הסרה"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!scanning && active.length > 0 && (
            <Button size="lg" variant="accent" onClick={enterReview}>
              המשך לבדיקה ({active.length} {active.length === 1 ? "הזמנה" : "הזמנות"})
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-primary-soft p-3 text-sm font-semibold text-secondary-foreground">
            זה מה שזיהינו. אפשר לתקן — שום דבר לא נשמר עד שתלחץ "יצירת הטיול" באשף.
          </div>
          {skipped > 0 && (
            <div className="flex gap-2 rounded-2xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                {skipped === 1 ? "קובץ אחד לא זוהה ודולג." : `${skipped} קבצים לא זוהו ודולגו.`}
              </span>
            </div>
          )}

          {/* Trip basics */}
          <section className="flex flex-col gap-3">
            <h3 className="font-bold">פרטי הטיול</h3>
            <Field label="יעד" hint={destination ? undefined : "לא זוהה יעד מההזמנות — כדאי למלא."}>
              <Input
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setTouched((t) => ({ ...t, destination: true }));
                }}
                placeholder="לדוגמה: רומא, איטליה"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="יציאה">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setTouched((t) => ({ ...t, dates: true }));
                  }}
                />
              </Field>
              <Field label="חזרה">
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setTouched((t) => ({ ...t, dates: true }));
                  }}
                />
              </Field>
            </div>
          </section>

          {/* Travellers */}
          <section className="flex flex-col gap-2">
            <h3 className="font-bold">נוסעים ({travellers.length})</h3>
            {travellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                לא נמצאו שמות נוסעים בהזמנות — אפשר להוסיף בשלב המשתתפים.
              </p>
            ) : (
              travellers.map((t) => {
                const age = t.birth_date ? ageOn(t.birth_date, startDate) : null;
                return (
                  <div key={t.key} className="flex flex-col gap-1 rounded-2xl border border-border p-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={t.name}
                        onChange={(e) => renameTraveller(t.key, e.target.value)}
                        dir="auto"
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold focus:outline-none"
                        aria-label="שם הנוסע"
                      />
                      {t.type && <Badge tone={t.type === "adult" ? "muted" : "sun"}>{TYPE_LABEL[t.type]}</Badge>}
                      {age != null && <Badge tone="primary">גיל {age}</Badge>}
                      <button
                        onClick={() => removeTraveller(t.key)}
                        className="grid size-8 shrink-0 place-items-center rounded-xl text-destructive"
                        aria-label="הסרה"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {(t.preferences.length > 0 || (t.type === "child" && age == null)) && (
                      <div className="flex flex-wrap gap-x-2 ps-1 text-[11px] text-muted-foreground">
                        {t.preferences.length > 0 && <span>{t.preferences.map(prefLabel).join(", ")}</span>}
                        {t.type === "child" && age == null && <span>ילד — כדאי להשלים גיל</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* Bookings */}
          <section className="flex flex-col gap-2">
            <h3 className="font-bold">הזמנות ({active.length})</h3>
            {active.map((it) => (
              <Card key={it.id} className="flex items-center gap-3 p-3 shadow-none">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary-soft text-lg">
                  {DOC_EMOJI[it.booking!.docType]}
                </div>
                <BookingSummary booking={it.booking!} />
                <button
                  onClick={() => removeBooking(it.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-xl text-destructive"
                  aria-label="הסרת ההזמנה"
                >
                  <Trash2 className="size-4" />
                </button>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">פרטים מלאים (מושבים, טרמינלים, אסמכתאות) יופיעו לעריכה בשלב הלוגיסטיקה.</p>
          </section>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setView("scan")}>
              <FilePlus className="size-4" />
              חזרה לקבצים
            </Button>
            <Button className="flex-1" variant="accent" disabled={!active.length} onClick={confirm}>
              <Sparkles className="size-4" />
              מילוי הטיול
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
