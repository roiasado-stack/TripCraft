import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Trip } from "@/lib/types";
import { Button, Modal } from "@/components/ui";

export function ShareSheet({
  trip,
  open,
  onClose,
  onChange,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Trip>) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";

  const toggle = async () => {
    setBusy(true);
    const next = !trip.is_shared;
    const { error } = await supabase.from("trips").update({ is_shared: next }).eq("id", trip.id);
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו לעדכן את השיתוף");
      return;
    }
    onChange({ is_shared: next });
    toast.success(next ? "הטיול משותף 🔗" : "השיתוף בוטל");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("לא ניתן להעתיק. סמן והעתק ידנית.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="שיתוף הטיול">
      <p className="mb-4 text-sm text-muted-foreground">
        שתף קישור לצפייה בלבד — הלקוח יראה את המסלול, הטיסות והמומלצים, בלי אפשרות לערוך ובלי גישה
        למסמכים הפרטיים.
      </p>

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-border p-3">
        <div>
          <div className="font-semibold">שיתוף פעיל</div>
          <div className="text-xs text-muted-foreground">
            {trip.is_shared ? "כל מי שיש לו את הקישור יכול לצפות" : "הטיול פרטי"}
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          role="switch"
          aria-checked={trip.is_shared}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${trip.is_shared ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${trip.is_shared ? "left-0.5" : "right-0.5"}`}
          />
        </button>
      </div>

      {trip.is_shared && url && (
        <div className="flex flex-col gap-2">
          <div dir="ltr" className="overflow-x-auto rounded-2xl bg-muted px-3 py-2.5 text-xs font-mono">
            {url}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              העתקת קישור
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button
                variant="outline"
                onClick={() => navigator.share?.({ title: trip.title, url })}
                aria-label="שיתוף"
              >
                <Share2 className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
