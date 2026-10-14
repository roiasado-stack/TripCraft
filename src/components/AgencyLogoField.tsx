import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui";
import {
  AGENCY_LOGO_BUCKET,
  LOGO_MAX_BYTES,
  fitWithin,
  isAgencyLogoUrl,
  logoFileProblem,
  logoObjectPath,
  logoPathFromUrl,
} from "@/lib/agency-brand";

/** The bucket's public URL prefix, ending in "/". */
export function agencyLogoPrefix(): string {
  const base = supabase.storage.from(AGENCY_LOGO_BUCKET).getPublicUrl("x").data.publicUrl;
  return base.slice(0, -1);
}

/**
 * Shrinks a picked image to at most 512px on its longest side and re-encodes
 * it (WebP, or PNG where the browser can't write WebP), keeping transparency.
 * Re-encoding also drops whatever else the file carried (EXIF, location).
 */
async function shrinkLogo(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || width === 0) throw new Error("no_canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("encode_failed");
  return blob;
}

/**
 * The agency logo row in Settings → מיתוג סוכנות (agents only). Uploads to the
 * public agency-logos bucket under the agent's own folder (migration 023),
 * saves the public URL on the profile, and removes the previous file.
 */
export function AgencyLogoField() {
  const { user, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const prefix = agencyLogoPrefix();
  const current = isAgencyLogoUrl(profile?.agency_logo_url, prefix) ? profile?.agency_logo_url : null;
  const bucket = supabase.storage.from(AGENCY_LOGO_BUCKET);

  const removeOld = async (oldUrl: string | null | undefined) => {
    const path = logoPathFromUrl(oldUrl, prefix);
    if (path) await bucket.remove([path]); // best effort: a leftover file is harmless
  };

  const upload = async (file: File) => {
    if (!user) return;
    const problem = logoFileProblem(file);
    if (problem) {
      toast.error(problem === "type" ? "אפשר להעלות לוגו בפורמט PNG, JPG או WebP בלבד" : "הקובץ גדול מדי (עד 10MB)");
      return;
    }
    setBusy("upload");
    try {
      const blob = await shrinkLogo(file);
      if (blob.size > LOGO_MAX_BYTES) {
        toast.error("הלוגו גדול מדי גם אחרי הקטנה. נסו קובץ פשוט יותר.");
        return;
      }
      const path = logoObjectPath(user.id, Date.now(), blob.type);
      const { error: upErr } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;
      const url = bucket.getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from("profiles").update({ agency_logo_url: url }).eq("id", user.id);
      if (error) {
        await bucket.remove([path]);
        throw error;
      }
      await removeOld(profile?.agency_logo_url);
      await refreshProfile();
      toast.success("הלוגו עודכן ✓");
    } catch (e) {
      console.error(e);
      toast.error("העלאת הלוגו נכשלה. נסו שוב.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!user) return;
    setBusy("remove");
    const old = profile?.agency_logo_url;
    const { error } = await supabase.from("profiles").update({ agency_logo_url: null }).eq("id", user.id);
    if (error) {
      setBusy(null);
      toast.error("הסרת הלוגו נכשלה");
      return;
    }
    await removeOld(old);
    await refreshProfile();
    setBusy(null);
    toast.success("הלוגו הוסר");
  };

  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
      <span className="type-body w-24 shrink-0">לוגו</span>
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-background">
        {current ? (
          <img src={current} alt="הלוגו של הסוכנות" className="size-full object-contain" />
        ) : (
          <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
        {current && (
          <Button size="sm" variant="ghost" loading={busy === "remove"} disabled={busy !== null} onClick={remove}>
            הסרה
          </Button>
        )}
        <Button
          size="sm"
          variant="soft"
          loading={busy === "upload"}
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
        >
          {current ? "החלפה" : "העלאה"}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
