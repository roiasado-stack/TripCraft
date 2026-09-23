import { useRef, useState } from "react";
import { AlertTriangle, FileUp, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Button, Chip, Field, Input, Modal, Segmented } from "@/components/ui";

/** Reads a File as a base64 data payload for the vision endpoint. Same shape as
 *  ImportParticipants' fileToBase64 — not exported there, so duplicated here
 *  rather than pulled into a shared util for one ~10-line helper. */
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

// Same 24h select pattern as TransportTab.tsx: a native datetime-local input's
// hour format follows the OS/browser locale, not the page's lang="he" — a date
// input plus explicit 00-23 / 00-59 <select>s sidesteps that entirely.
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

const HINT_OPTIONS = [
  { value: "flight", label: "טיסה", emoji: "✈️" },
  { value: "hotel", label: "מלון", emoji: "🏨" },
  { value: "car", label: "רכב / העברה", emoji: "🚗" },
  { value: "other", label: "לא בטוח", emoji: "📄" },
] as const;
type Hint = (typeof HINT_OPTIONS)[number]["value"];

export type VoucherDocType = "flight" | "hotel" | "car";

export interface VoucherFlightData {
  direction: string; // outbound | inbound
  airline: string | null;
  flight_number: string | null;
  from_airport: string | null;
  to_airport: string | null;
  depart_at: string | null; // ISO
  arrive_at: string | null; // ISO
  from_terminal: string | null;
  to_terminal: string | null;
  seats: string | null;
  baggage: string | null;
  booking_ref: string | null;
  notes: string | null;
}
export interface VoucherHotelData {
  hotel_name: string;
  address: string | null;
  check_in: string | null; // DATE
  check_out: string | null; // DATE
  booking_ref: string | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
}
export interface VoucherCarData {
  provider: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_at: string | null; // ISO
  return_at: string | null; // ISO
  booking_ref: string | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
}
export type VoucherData = VoucherFlightData | VoucherHotelData | VoucherCarData;

const blankFlight: VoucherFlightData = {
  direction: "outbound",
  airline: null,
  flight_number: null,
  from_airport: null,
  to_airport: null,
  depart_at: null,
  arrive_at: null,
  from_terminal: null,
  to_terminal: null,
  seats: null,
  baggage: null,
  booking_ref: null,
  notes: null,
};
const blankHotel: VoucherHotelData = {
  hotel_name: "",
  address: null,
  check_in: null,
  check_out: null,
  booking_ref: null,
  phone: null,
  url: null,
  notes: null,
};
const blankCar: VoucherCarData = {
  provider: null,
  pickup_location: null,
  dropoff_location: null,
  pickup_at: null,
  return_at: null,
  booking_ref: null,
  phone: null,
  url: null,
  notes: null,
};

/** A date + 24h-time pair of controls, matching TransportTab's departure fields. */
function DateTimeFields({
  dateLabel,
  timeLabel,
  iso,
  onChange,
}: {
  dateLabel: string;
  timeLabel: string;
  iso: string | null;
  onChange: (iso: string | null) => void;
}) {
  const date = isoToDatePart(iso);
  const hour = isoToHour(iso);
  const minute = isoToMinute(iso);
  const set = (d: string, h: string, m: string) => onChange(partsToIso(d, h, m));
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={dateLabel}>
        <Input type="date" value={date} onChange={(e) => set(e.target.value, hour, minute)} />
      </Field>
      <Field label={timeLabel}>
        <div className="flex items-center gap-1">
          <select
            value={hour}
            onChange={(e) => set(date, e.target.value, minute)}
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
            value={minute}
            onChange={(e) => set(date, hour, e.target.value)}
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
  );
}

function FlightFields({
  data,
  patch,
}: {
  data: VoucherFlightData;
  patch: (p: Partial<VoucherFlightData>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        options={[
          { value: "outbound", label: "הלוך" },
          { value: "inbound", label: "חזור" },
        ]}
        value={data.direction === "inbound" ? "inbound" : "outbound"}
        onChange={(v) => patch({ direction: v })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="חברת תעופה">
          <Input value={data.airline ?? ""} onChange={(e) => patch({ airline: e.target.value })} />
        </Field>
        <Field label="מספר טיסה">
          <Input value={data.flight_number ?? ""} onChange={(e) => patch({ flight_number: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="משדה">
          <Input
            value={data.from_airport ?? ""}
            onChange={(e) => patch({ from_airport: e.target.value })}
            placeholder="TLV"
          />
        </Field>
        <Field label="לשדה">
          <Input
            value={data.to_airport ?? ""}
            onChange={(e) => patch({ to_airport: e.target.value })}
            placeholder="CDG"
          />
        </Field>
      </div>
      <DateTimeFields
        dateLabel="תאריך המראה"
        timeLabel="שעת המראה (24 שעות)"
        iso={data.depart_at}
        onChange={(iso) => patch({ depart_at: iso })}
      />
      <DateTimeFields
        dateLabel="תאריך נחיתה"
        timeLabel="שעת נחיתה (24 שעות)"
        iso={data.arrive_at}
        onChange={(iso) => patch({ arrive_at: iso })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="טרמינל יציאה">
          <Input value={data.from_terminal ?? ""} onChange={(e) => patch({ from_terminal: e.target.value })} />
        </Field>
        <Field label="טרמינל נחיתה">
          <Input value={data.to_terminal ?? ""} onChange={(e) => patch({ to_terminal: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="מושבים">
          <Input value={data.seats ?? ""} onChange={(e) => patch({ seats: e.target.value })} />
        </Field>
        <Field label="כבודה">
          <Input value={data.baggage ?? ""} onChange={(e) => patch({ baggage: e.target.value })} />
        </Field>
      </div>
      <Field label="אסמכתה">
        <Input value={data.booking_ref ?? ""} onChange={(e) => patch({ booking_ref: e.target.value })} />
      </Field>
      <Field label="הערות">
        <Input value={data.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function HotelFields({
  data,
  patch,
}: {
  data: VoucherHotelData;
  patch: (p: Partial<VoucherHotelData>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="שם המלון">
        <Input value={data.hotel_name} onChange={(e) => patch({ hotel_name: e.target.value })} />
      </Field>
      <Field label="כתובת">
        <Input value={data.address ?? ""} onChange={(e) => patch({ address: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="צ'ק אין">
          <Input
            type="date"
            value={data.check_in ?? ""}
            onChange={(e) => patch({ check_in: e.target.value || null })}
          />
        </Field>
        <Field label="צ'ק אאוט">
          <Input
            type="date"
            value={data.check_out ?? ""}
            onChange={(e) => patch({ check_out: e.target.value || null })}
          />
        </Field>
      </div>
      <Field label="אסמכתה">
        <Input value={data.booking_ref ?? ""} onChange={(e) => patch({ booking_ref: e.target.value })} />
      </Field>
      <Field label="טלפון">
        <Input dir="ltr" className="text-right" value={data.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} />
      </Field>
      <Field label="אתר המלון">
        <Input
          dir="ltr"
          className="text-right"
          value={data.url ?? ""}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://…"
        />
      </Field>
      <Field label="הערות">
        <Input value={data.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function CarFields({
  data,
  patch,
}: {
  data: VoucherCarData;
  patch: (p: Partial<VoucherCarData>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="ספק">
        <Input value={data.provider ?? ""} onChange={(e) => patch({ provider: e.target.value })} />
      </Field>
      <Field label="נקודת איסוף">
        <Input value={data.pickup_location ?? ""} onChange={(e) => patch({ pickup_location: e.target.value })} />
      </Field>
      <Field label="נקודת החזרה">
        <Input value={data.dropoff_location ?? ""} onChange={(e) => patch({ dropoff_location: e.target.value })} />
      </Field>
      <DateTimeFields
        dateLabel="תאריך איסוף"
        timeLabel="שעת איסוף (24 שעות)"
        iso={data.pickup_at}
        onChange={(iso) => patch({ pickup_at: iso })}
      />
      <DateTimeFields
        dateLabel="תאריך החזרה"
        timeLabel="שעת החזרה (24 שעות)"
        iso={data.return_at}
        onChange={(iso) => patch({ return_at: iso })}
      />
      <Field label="אסמכתה">
        <Input value={data.booking_ref ?? ""} onChange={(e) => patch({ booking_ref: e.target.value })} />
      </Field>
      <Field label="טלפון">
        <Input dir="ltr" className="text-right" value={data.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} />
      </Field>
      <Field label="קישור להזמנה">
        <Input
          dir="ltr"
          className="text-right"
          value={data.url ?? ""}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://…"
        />
      </Field>
      <Field label="הערות">
        <Input value={data.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

export function ImportVoucher({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the classified doc type, the (already user-edited) data, and the
   *  original source file — callers decide whether to insert a row, also save
   *  the file to Storage, or (in the Wizard, pre-trip) just stage it locally.
   *  Nothing is written by this component itself. */
  onConfirm: (docType: VoucherDocType, data: VoucherData, sourceFile: File | null) => void | Promise<void>;
}) {
  const toast = useToast();
  const [hint, setHint] = useState<Hint>("other");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ docType: VoucherDocType; data: VoucherData } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setHint("other");
    setScanning(false);
    setSourceFile(null);
    setResult(null);
    setNotFound(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    if (files.length > 8) {
      toast.error("עד 8 קבצים בבת אחת.");
      return;
    }
    setNotFound(false);
    setScanning(true);
    try {
      const images = await Promise.all(files.map(fileToBase64));
      const { data, error } = await supabase.functions.invoke("generate", {
        body: { kind: "voucher", images, hint: hint === "other" ? undefined : hint },
      });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        toast.error(
          msg.includes("not found") || msg.includes("404") || msg.includes("failed to fetch")
            ? "סריקת שוברים דורשת הפעלת ה-AI. ראה README."
            : "סריקת השובר נכשלה.",
        );
        return;
      }
      const res = data as { ok?: boolean; doc_type?: string; data?: Record<string, unknown> | null };
      if (!res?.ok || !res.doc_type || res.doc_type === "unknown" || !res.data) {
        setNotFound(true);
        return;
      }
      // The primary document, kept for callers that also upload the source
      // file to Storage. Multiple images (e.g. several pages of one voucher)
      // are all sent for extraction, but only the first is preserved as the
      // saved file — a documented simplification, same spirit as passport
      // scanning not saving the source photos at all.
      setSourceFile(files[0] ?? null);
      if (res.doc_type === "flight") {
        setResult({ docType: "flight", data: { ...blankFlight, ...(res.data as Partial<VoucherFlightData>) } });
      } else if (res.doc_type === "hotel") {
        setResult({ docType: "hotel", data: { ...blankHotel, ...(res.data as Partial<VoucherHotelData>) } });
      } else if (res.doc_type === "car") {
        setResult({ docType: "car", data: { ...blankCar, ...(res.data as Partial<VoucherCarData>) } });
      } else {
        setNotFound(true);
        return;
      }
      toast.success("השובר זוהה 🧾");
    } catch {
      toast.error("סריקת השובר נכשלה.");
    } finally {
      setScanning(false);
    }
  };

  const confirm = async () => {
    if (!result) return;
    if (result.docType === "hotel" && !(result.data as VoucherHotelData).hotel_name.trim()) {
      toast.error("שם המלון חובה");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(result.docType, result.data, sourceFile);
      close();
    } finally {
      setBusy(false);
    }
  };

  const patchFlight = (patch: Partial<VoucherFlightData>) =>
    setResult((r) => (r && r.docType === "flight" ? { ...r, data: { ...(r.data as VoucherFlightData), ...patch } } : r));
  const patchHotel = (patch: Partial<VoucherHotelData>) =>
    setResult((r) => (r && r.docType === "hotel" ? { ...r, data: { ...(r.data as VoucherHotelData), ...patch } } : r));
  const patchCar = (patch: Partial<VoucherCarData>) =>
    setResult((r) => (r && r.docType === "car" ? { ...r, data: { ...(r.data as VoucherCarData), ...patch } } : r));

  const title = !result
    ? "סריקת שובר הזמנה"
    : result.docType === "flight"
      ? "בדיקת פרטי הטיסה"
      : result.docType === "hotel"
        ? "בדיקת פרטי המלון"
        : "בדיקת פרטי הרכב/ההעברה";

  return (
    <Modal open={open} onClose={close} title={title}>
      {!result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            צלם או בחר תמונה/PDF של אישור טיסה, מלון או רכב — נזהה את הפרטים אוטומטית ונציג טופס לבדיקה
            לפני שמירה.
          </p>

          <div>
            <div className="mb-1.5 text-sm font-semibold">מה זה?</div>
            <div className="flex flex-wrap gap-1.5">
              {HINT_OPTIONS.map((o) => (
                <Chip key={o.value} active={hint === o.value} onClick={() => setHint(o.value)}>
                  {o.emoji} {o.label}
                </Chip>
              ))}
            </div>
          </div>

          <Button size="lg" loading={scanning} onClick={() => fileRef.current?.click()}>
            <Sparkles className="size-5" />
            סריקת שובר
          </Button>
          {/* No `capture` attribute: see DocumentsTab.tsx for why — forcing
              camera-only skips iOS's native picker sheet, which is also how
              Drive-provider uploads show up as a source. */}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onFiles} />
          <p className="-mt-1 text-center text-xs text-muted-foreground">
            עד 8 תמונות/מסמכי PDF. דורש הפעלת AI.
          </p>

          {notFound && (
            <div className="flex gap-2 rounded-2xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <span>לא זוהה כשובר הזמנה — נסה תמונה ברורה יותר.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-primary-soft p-3 text-sm font-semibold text-secondary-foreground">
            {result.docType === "flight" && "זוהתה טיסה. אפשר לתקן לפני ההוספה:"}
            {result.docType === "hotel" && "זוהה אישור מלון. אפשר לתקן לפני ההוספה:"}
            {result.docType === "car" && "זוהה אישור רכב/העברה. אפשר לתקן לפני ההוספה:"}
          </div>

          {result.docType === "flight" && <FlightFields data={result.data as VoucherFlightData} patch={patchFlight} />}
          {result.docType === "hotel" && <HotelFields data={result.data as VoucherHotelData} patch={patchHotel} />}
          {result.docType === "car" && <CarFields data={result.data as VoucherCarData} patch={patchCar} />}

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setResult(null);
                setSourceFile(null);
              }}
            >
              חזרה
            </Button>
            <Button className="flex-1" variant="accent" loading={busy} onClick={confirm}>
              <FileUp className="size-4" />
              הוספה
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
