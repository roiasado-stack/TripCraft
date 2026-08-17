import { useState } from "react";
import { Camera, ExternalLink, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Trip } from "@/lib/types";
import { isSafeHttpUrl } from "@/lib/maps";
import { Button, Card, Field, Input, Modal } from "@/components/ui";

/**
 * A single shared album link for the whole group (Google Photos, iCloud, etc.).
 * We store the link rather than the photos: albums stay where people already
 * keep them, and nothing private is copied into the app.
 */
export function PhotoAlbumCard({ trip, editable = true }: { trip: Trip; editable?: boolean }) {
  const toast = useToast();
  const [url, setUrl] = useState(trip.photos_album_url ?? "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = draft.trim();
    if (value && !isSafeHttpUrl(value)) {
      toast.error("הקישור צריך להתחיל ב-https://");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("trips")
      .update({ photos_album_url: value || null })
      .eq("id", trip.id);
    setSaving(false);
    if (error) {
      toast.error("השמירה נכשלה. ודא שהרצת את מיגרציה 002.");
      return;
    }
    setUrl(value);
    setOpen(false);
    toast.success(value ? "אלבום התמונות נשמר 📸" : "הקישור הוסר");
  };

  if (!editable && !url) return null;

  return (
    <>
      <Card className="mt-4 flex items-center gap-3 p-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-sunset text-white">
          <Camera className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">אלבום התמונות המשותף</div>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="block truncate text-xs text-primary underline underline-offset-2"
            >
              {url}
            </a>
          ) : (
            <div className="text-xs text-muted-foreground">
              צרו אלבום משותף ב-Google Photos והדביקו כאן את הקישור
            </div>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-primary"
            aria-label="פתיחת האלבום"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
        {editable && (
          <button
            onClick={() => {
              setDraft(url);
              setOpen(true);
            }}
            className="shrink-0 text-muted-foreground"
            aria-label="עריכת הקישור"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="אלבום תמונות משותף"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              ביטול
            </Button>
            <Button className="flex-1" loading={saving} onClick={save}>
              שמירה
            </Button>
          </>
        }
      >
        <ol className="mb-4 space-y-1.5 text-xs text-muted-foreground">
          <li>1. ב-Google Photos: אלבומים ← יצירת אלבום.</li>
          <li>2. שיתוף ← יצירת קישור, והפעלת "שיתוף פעולה" כדי שכולם יוכלו להוסיף.</li>
          <li>3. העתיקו את הקישור והדביקו כאן.</li>
        </ol>
        <Field label="קישור לאלבום" hint="עובד גם עם iCloud, Dropbox או כל שירות אחר.">
          <Input
            dir="ltr"
            className="text-right"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://photos.app.goo.gl/…"
          />
        </Field>
      </Modal>
    </>
  );
}
