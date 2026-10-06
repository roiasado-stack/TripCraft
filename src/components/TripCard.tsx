import { useState } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { Trip, TripRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/permissions";
import { Button, Modal } from "@/components/ui";
import { countdownLabel, dateRangeHeb, daysFrom, tripPhase } from "@/lib/trip-dates";
import { Flag } from "@/components/Flag";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * One trip in the trips list, as a row of a GroupedList: flag, title,
 * destination, dates and one quiet status line. The owner's destructive action
 * lives behind "⋯", away from the row's tap target.
 */
export function TripCard({
  trip,
  role = "owner",
  today,
  onDeleted,
}: {
  trip: Trip;
  /** A trip shared with the caller shows its role and has no "⋯" menu. */
  role?: TripRole;
  today: Date;
  onDeleted?: (id: string) => void;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const phase = tripPhase(trip, today);
  const toStart = daysFrom(trip.start_date, today);
  const status = phase === "now" ? "בטיול עכשיו" : phase === "upcoming" && toStart !== null ? countdownLabel(toStart) : null;
  const meta = [dateRangeHeb(trip.start_date, trip.end_date, today), role !== "owner" ? ROLE_LABELS[role] : null]
    .filter(Boolean)
    .join(" · ");

  const remove = async () => {
    setDeleting(true);
    const { error } = await supabase.from("trips").delete().eq("id", trip.id);
    setDeleting(false);
    if (error) {
      toast.error("מחיקת הטיול נכשלה. נסה שוב.");
      return;
    }
    setConfirmOpen(false);
    toast.success("הטיול נמחק");
    onDeleted?.(trip.id);
  };

  // One element per trip, so the GroupedList's hairlines never land on the modals.
  return (
    <div>
      <div className="flex items-center">
        <Link
          to={`/trip/${trip.id}`}
          className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 ps-4 pe-2 transition-colors active:bg-muted/70"
        >
          <Flag destination={trip.destination} fallback={trip.cover_emoji} className="w-[44px] text-[30px]" />
          <div className="min-w-0 flex-1">
            <div className="type-headline line-clamp-2 [overflow-wrap:anywhere]">{trip.title}</div>
            <div className="type-footnote truncate text-muted-foreground">{trip.destination}</div>
            {(meta || status) && (
              <div className="type-footnote mt-0.5 flex flex-wrap gap-x-1.5">
                {meta && <span className="text-muted-foreground">{meta}</span>}
                {meta && status && <span className="text-muted-foreground">·</span>}
                {status && (
                  <span className={cn("font-semibold", phase === "now" ? "text-accent" : "text-primary")}>{status}</span>
                )}
              </div>
            )}
          </div>
        </Link>
        {role === "owner" && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="אפשרויות לטיול"
            className="me-1 grid size-[44px] shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
          >
            <MoreHorizontal className="size-5" />
          </button>
        )}
      </div>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title={trip.title}>
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            setConfirmOpen(true);
          }}
          className="flex w-full items-center gap-3 rounded-2xl bg-muted px-4 py-3.5 text-start font-semibold text-destructive transition-colors active:bg-destructive/10"
        >
          <Trash2 className="size-5" />
          מחיקת הטיול
        </button>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="מחיקת טיול"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmOpen(false)}>
              ביטול
            </Button>
            <Button variant="destructive" className="flex-1" loading={deleting} onClick={remove}>
              מחק טיול
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          למחוק את "{trip.title}"? המסלול, המשתתפים, המסמכים והצ'קליסט של הטיול יימחקו לצמיתות. אי אפשר לשחזר.
        </p>
      </Modal>
    </div>
  );
}
