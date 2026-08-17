import { useRef, useState } from "react";
import { AlertTriangle, FileUp, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Trip } from "@/lib/types";
import { Button, Card, Modal, Textarea } from "@/components/ui";
import { parseItinerary, type ParsedItem } from "@/lib/import-itinerary";
import { fileToParsableText, TABULAR_ACCEPT } from "@/lib/read-tabular";
import { formatDayHeb, itineraryCategory } from "@/lib/trip-options";

const SAMPLE = `תאריך,שעה,כותרת,מיקום,קטגוריה
10/09/2026,09:00,נחיתה והעברה למלון,נמל התעופה,תחבורה
10/09/2026,14:00,צ'ק אין ומנוחה,המלון,לינה
11/09/2026,10:00,סיור בעיר העתיקה,מרכז העיר,פעילות`;

export function ImportItinerary({
  trip,
  open,
  onClose,
  onImported,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ParsedItem[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const res = parseItinerary(raw, trip.start_date);
    setErrors(res.errors);
    setPreview(res.items);
    if (res.items.length === 0 && res.errors.length === 0) {
      setErrors(["לא נמצאו פריטים לייבוא."]);
    }
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

  const confirmImport = async () => {
    if (!preview?.length) return;
    setSaving(true);
    try {
      const rows = preview.map((p, idx) => ({ ...p, trip_id: trip.id, sort_order: idx }));
      const { error } = await supabase.from("itinerary_items").insert(rows);
      if (error) throw error;
      toast.success(`יובאו ${rows.length} פריטים למסלול 🎉`);
      onImported();
      close();
    } catch (err) {
      console.error(err);
      toast.error("הייבוא נכשל. נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const byDay = (preview ?? []).reduce<Record<string, ParsedItem[]>>((acc, item) => {
    (acc[item.day_date] ??= []).push(item);
    return acc;
  }, {});

  return (
    <Modal open={open} onClose={close} title="ייבוא מסלול מוכן">
      {!preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            הדבק מסלול מ-Excel / Google Sheets, או העלה קובץ ‎.xlsx‎ / CSV / JSON. אפשר כותרות
            בעברית או באנגלית — נזהה אותן אוטומטית.
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
            className="min-h-[160px] font-mono text-xs"
            dir="ltr"
          />

          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => analyse(text)} disabled={!text.trim()}>
              <Sparkles className="size-4" />
              ניתוח התוכן
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" />
              קובץ
            </Button>
          </div>
          <input ref={fileRef} type="file" accept={TABULAR_ACCEPT} hidden onChange={onFile} />

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
            זוהו {preview.length} פריטים על פני {Object.keys(byDay).length} ימים. בדוק ואשר:
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

          <div className="max-h-64 overflow-y-auto rounded-2xl border border-border">
            {Object.keys(byDay)
              .sort()
              .map((day) => (
                <div key={day} className="border-b border-border last:border-0">
                  <div className="bg-muted px-3 py-1.5 text-xs font-bold">{formatDayHeb(day)}</div>
                  {byDay[day].map((it, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span>{itineraryCategory(it.category).emoji}</span>
                      {it.start_time && <span className="text-xs font-bold text-primary">{it.start_time}</span>}
                      <span className="flex-1 truncate">{it.title}</span>
                      {it.location && <span className="truncate text-xs text-muted-foreground">{it.location}</span>}
                    </div>
                  ))}
                </div>
              ))}
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPreview(null)}>
              חזרה
            </Button>
            <Button className="flex-1" variant="accent" loading={saving} onClick={confirmImport}>
              ייבוא {preview.length} פריטים
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
