import { useRef, useState } from "react";
import { AlertTriangle, FileUp, IdCard, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Button, Modal, Textarea } from "@/components/ui";
import { parseParticipants, type ParsedParticipant } from "@/lib/import-participants";
import { fileToParsableText, TABULAR_ACCEPT } from "@/lib/read-tabular";
import { prefLabel } from "@/lib/trip-options";

const SAMPLE = `יעל כהן, 7, חוף
דני כהן, 34, ספורט
נועה כהן, 9
רות לוי, 65+, נגישות`;

/** Reads a File as a base64 data payload for the vision endpoint. */
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

export function ImportParticipants({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the approved list. Caller decides whether to save or stage it. */
  onConfirm: (items: ParsedParticipant[]) => void | Promise<void>;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ParsedParticipant[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const passportRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText("");
    setPreview(null);
    setErrors([]);
  };
  const close = () => {
    reset();
    onClose();
  };

  const analyse = (raw: string) => {
    const res = parseParticipants(raw);
    setErrors(res.errors);
    setPreview(res.items);
    if (res.items.length === 0 && res.errors.length === 0) setErrors(["לא נמצאו משתתפים."]);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    try {
      const content = await fileToParsableText(file);
      setText(content);
      analyse(content);
    } catch (err) {
      console.error(err);
      toast.error("לא הצלחנו לקרוא את הקובץ. נסה CSV או Excel תקין.");
    }
  };

  /** Passport photos → names/ages via the vision edge function. */
  const onPassports = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    if (passportRef.current) passportRef.current.value = "";
    if (!files.length) return;
    if (files.length > 8) {
      toast.error("עד 8 דרכונים בבת אחת.");
      return;
    }
    setScanning(true);
    try {
      const images = await Promise.all(files.map(fileToBase64));
      const { data, error } = await supabase.functions.invoke("generate", {
        body: { kind: "passports", images },
      });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        toast.error(
          msg.includes("not found") || msg.includes("404") || msg.includes("failed to fetch")
            ? "סריקת דרכונים דורשת הפעלת ה-AI. ראה README."
            : "סריקת הדרכונים נכשלה.",
        );
        return;
      }
      const items = (data as { items?: ParsedParticipant[] })?.items ?? [];
      if (!items.length) {
        toast.error("לא זוהו פרטים בדרכונים. נסה תמונה ברורה יותר.");
        return;
      }
      setPreview(items);
      setErrors([]);
      toast.success(`זוהו ${items.length} נוסעים 🛂`);
    } catch {
      toast.error("סריקת הדרכונים נכשלה.");
    } finally {
      setScanning(false);
    }
  };

  const confirm = async () => {
    if (!preview?.length) return;
    setBusy(true);
    try {
      await onConfirm(preview);
      close();
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<ParsedParticipant>) =>
    setPreview((prev) => (prev ? prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) : prev));
  const removeAt = (i: number) => setPreview((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));

  return (
    <Modal open={open} onClose={close} title="הוספת משתתפים בכמות">
      {!preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            הדבק רשימת שמות — שורה לכל נוסע. אפשר גם להעלות קובץ Excel‏ (.xlsx), CSV או JSON. גיל
            והעדפות אחרי פסיק (אופציונלי).
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
            className="min-h-[150px]"
          />

          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => analyse(text)} disabled={!text.trim()}>
              <Sparkles className="size-4" />
              ניתוח הרשימה
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} aria-label="קובץ">
              <FileUp className="size-4" />
            </Button>
          </div>
          <input ref={fileRef} type="file" accept={TABULAR_ACCEPT} hidden onChange={onFile} />

          <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>או</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" size="lg" loading={scanning} onClick={() => passportRef.current?.click()}>
            <IdCard className="size-5" />
            סריקת דרכונים מתמונה
          </Button>
          <p className="-mt-1 text-center text-xs text-muted-foreground">
            צלם או בחר עד 8 דרכונים — נזהה שם וגיל אוטומטית. דורש הפעלת AI.
          </p>
          <input
            ref={passportRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={onPassports}
          />

          <button
            onClick={() => {
              setText(SAMPLE);
              analyse(SAMPLE);
            }}
            className="text-xs font-semibold text-primary underline underline-offset-2"
          >
            נסה עם דוגמה
          </button>

          {errors.length > 0 && (
            <div className="rounded-2xl bg-destructive/10 p-3 text-xs text-destructive">
              {errors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-primary-soft p-3 text-sm font-semibold text-secondary-foreground">
            זוהו {preview.length} משתתפים. אפשר לתקן לפני ההוספה:
          </div>

          {errors.length > 0 && (
            <div className="flex gap-2 rounded-2xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <div>
                {errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {preview.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-2xl border border-border p-2">
                <input
                  value={p.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold focus:outline-none"
                />
                <input
                  value={p.age ?? ""}
                  onChange={(e) =>
                    update(i, { age: e.target.value ? Number(e.target.value) : null })
                  }
                  type="number"
                  min={0}
                  max={120}
                  placeholder={p.age_range ?? "גיל"}
                  className="w-16 rounded-lg border border-input bg-card px-2 py-1 text-center text-sm"
                />
                {p.preferences.length > 0 && (
                  <span className="max-w-[6rem] truncate text-[11px] text-muted-foreground">
                    {p.preferences.map(prefLabel).join(", ")}
                  </span>
                )}
                <button onClick={() => removeAt(i)} className="px-1 text-destructive" aria-label="הסרה">
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPreview(null)}>
              חזרה
            </Button>
            <Button className="flex-1" variant="accent" loading={busy} onClick={confirm} disabled={!preview.length}>
              הוספת {preview.length}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
