import { Link } from "react-router-dom";
import { Calendar, MapPin } from "lucide-react";
import type { Trip } from "@/lib/types";
import { Badge } from "@/components/ui";
import { daysUntil, formatHeb, tripTypeEmoji, tripTypeLabel } from "@/lib/trip-options";

export function TripCard({ trip }: { trip: Trip }) {
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

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="group relative flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-soft transition active:scale-[0.99]"
    >
      <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-sea text-3xl shadow-soft">
        {trip.cover_emoji ?? "🌴"}
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
    </Link>
  );
}
