import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Trip, TripRole } from "@/lib/types";
import { InsetGroup, Modal, Segmented, Switch } from "@/components/ui";
import { TripMembers } from "@/components/TripMembers";
import { useAuth } from "@/hooks/use-auth";

const actionRow =
  "type-headline flex min-h-12 w-full items-center gap-3 px-4 py-3 text-start text-primary transition-colors active:bg-foreground/5";

export function ShareSheet({
  trip,
  role,
  open,
  onClose,
  onChange,
}: {
  trip: Trip;
  role: TripRole;
  open: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Trip>) => void;
}) {
  const toast = useToast();
  const { isAnonymous } = useAuth();
  // Public link and showcase are owner-only; demo copies can't be made public (016).
  const canPublish = role === "owner" && !isAnonymous;
  const [view, setView] = useState<"members" | "public">("members");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = trip.share_slug ? `${window.location.origin}/share/${trip.share_slug}` : "";

  const toggle = async () => {
    setBusy(true);
    const next = !trip.is_shared;
    // A showcase must stay shared (guard_trip_update), so unsharing ends it too.
    const { error } = await supabase
      .from("trips")
      .update(next ? { is_shared: true } : { is_shared: false, is_showcase: false })
      .eq("id", trip.id);
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו לעדכן את השיתוף");
      return;
    }
    onChange({ is_shared: next, ...(next ? {} : { is_showcase: false }) });
    toast.success(next ? "הטיול משותף 🔗" : "השיתוף בוטל");
  };

  const toggleShowcase = async () => {
    setBusy(true);
    const next = !trip.is_showcase;
    const { error } = await supabase.from("trips").update({ is_showcase: next }).eq("id", trip.id);
    setBusy(false);
    if (error) {
      toast.error("לא הצלחנו לעדכן");
      return;
    }
    onChange({ is_showcase: next });
    toast.success(next ? "גולשים יכולים לנסות עותק של הטיול" : "האפשרות לנסות עותק כובתה");
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
      {canPublish && (
        <Segmented
          className="mb-5"
          value={view}
          onChange={setView}
          options={[
            { value: "members", label: "חברים" },
            { value: "public", label: "קישור ציבורי" },
          ]}
        />
      )}

      {view === "members" || !canPublish ? (
        <TripMembers trip={trip} role={role} />
      ) : (
        <div className="flex flex-col gap-5">
          <section>
            <InsetGroup>
              <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="type-headline">שיתוף פעיל</div>
                  <div className="type-footnote text-muted-foreground">
                    {trip.is_shared ? "כל מי שיש לו את הקישור יכול לצפות" : "הטיול פרטי"}
                  </div>
                </div>
                <Switch checked={trip.is_shared} onChange={toggle} disabled={busy} label="שיתוף פעיל" />
              </div>
              {trip.is_shared && url && (
                <>
                  <div dir="ltr" className="overflow-x-auto whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                    {url}
                  </div>
                  <button type="button" onClick={copy} className={actionRow}>
                    {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                    העתקת הקישור
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button
                      type="button"
                      onClick={() => navigator.share?.({ title: trip.title, url }).catch(() => {})}
                      className={actionRow}
                    >
                      <Share2 className="size-5" />
                      שיתוף…
                    </button>
                  )}
                </>
              )}
            </InsetGroup>
            <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
              קישור לצפייה בלבד, בלי התחברות: המסלול, הטיסות (בלי מספרי הזמנה) והמומלצים. בלי משתתפים, מסמכים
              וצ'קליסט. כדי שמישהו יראה את כל הפרטים, הזמינו אותו בלשונית "חברים".
            </p>
          </section>

          {trip.is_shared && url && (
            <section>
              <InsetGroup>
                <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <div className="type-headline min-w-0 flex-1">"נסו בעצמכם"</div>
                  <Switch checked={trip.is_showcase} onChange={toggleShowcase} disabled={busy} label="נסו בעצמכם" />
                </div>
              </InsetGroup>
              <p className="type-footnote mt-1.5 px-4 text-muted-foreground">
                כפתור בדף הציבורי שנותן לגולשים עותק אישי לעריכה. כל תוכן הטיול מועתק חוץ ממספרי הזמנה והערות, אז
                סמנו רק טיול דמו.
              </p>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
