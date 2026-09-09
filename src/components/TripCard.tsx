import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, MapPin, Trash2 } from "lucide-react";
import type { Trip } from "@/lib/types";
import { Badge, Button, Modal } from "@/components/ui";
import { daysUntil, destinationFlag, formatHeb, tripTypeEmoji, tripTypeLabel } from "@/lib/trip-options";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export function TripCard({ trip, onDeleted }: { trip: Trip; onDeleted?: (id: string) => void }) {
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const until = daysUntil(trip.start_date);
  const ongoing =
    until !== null &&
    until <= 0 &&
    trip.end_date !== null &&
    (daysUntil(trip.end_date) ?? -1) >= 0;

  let countdown: { text: string; tone: "sun" | "accent" | "muted" } | null = null;
  if (ongoing) countdown = { text: "בטיול עכשיו! 🌊", tone: "accent" };
  else if (until !== null && until > 0)
    countdown = { text: `בעוד ${until} ימים`, tone: until <= 30 ? "sun" : "muted" };
  else if (until !== null && until <= 0) countdown = { text: "הסתיים", tone: "muted" };

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

  return (
    <>
      <Link
        to={`/trip/${trip.id}`}
        className="group relative flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-soft transition active:scale-[0.99]"
      >
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-sea text-3xl shadow-soft">
          {destinationFlag(trip.destination) ?? trip.cover_emoji ?? "🌍"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold">{trip.title}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{trip.destination}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">
              {tripTypeEmoji(trip.trip_type)} {tripTypeLabel(trip.trip_type)}
            </Badge>
            {trip.start_date && (
              <Badge tone="muted">
                <Calendar className="size-3" />
                {formatHeb(trip.start_date)}
              </Badge>
            )}
            {countdown && <Badge tone={countdown.tone}>{countdown.text}</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          aria-label="מחיקת טיול"
          className="grid size-9 shrink-0 place-items-center self-start rounded-xl text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </Link>

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
    </>
  );
}
