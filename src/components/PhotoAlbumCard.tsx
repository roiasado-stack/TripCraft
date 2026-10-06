import { useState } from "react";
import { Camera, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Trip } from "@/lib/types";
import { isSafeHttpUrl } from "@/lib/maps";
import { Button, Field, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A single shared album link for the whole group (Google Photos, iCloud, etc.).
 * We store the link rather than the photos: albums stay where people already
 * keep them, and nothing private is copied into the app.
 */
export function PhotoAlbumCard({
  trip,
  editable = true,
  className = "mt-4",
}: {
  trip: Pick<Trip, "id" | "photos_album_url">;
  editable?: boolean;
  className?: string;
}) {
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

  // The save check above is client-side only — the column can be written
  // straight through the API, and this card renders on the public share page.
  // Never put a non-http(s) URL (e.g. javascript:) in an href.
  const safeUrl = url && isSafeHttpUrl(url) ? url : "";

  if (!editable && !safeUrl) return null;

  return (
    <>
      <div className={cn("flex items-center gap-2 rounded-2xl bg-card py-3 ps-4 pe-2 text-card-foreground", className)}>
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-sunset text-white">
          <Camera className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="type-headline [overflow-wrap:anywhere]">אלבום התמונות המשותף</div>
          {safeUrl ? (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="type-footnote block truncate text-primary"
            >
              {safeUrl}
            </a>
          ) : (
            <div className="type-footnote text-muted-foreground">
              צרו אלבום משותף ב-Google Photos והדביקו כאן את הקישור
            </div>
          )}
        </div>
        {editable && (
          <button
            onClick={() => {
              setDraft(url);
              setOpen(true);
            }}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
            aria-label="עריכת הקישור"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </div>

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
