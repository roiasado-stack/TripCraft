import { Link } from "react-router-dom";
import { ChevronRight, Share2 } from "lucide-react";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TripHeader({
  trip,
  subtitle,
  onShare,
}: {
  trip: Trip;
  subtitle?: string;
  onShare?: () => void;
}) {
  return (
    <header className="mb-4 flex items-center gap-3 pt-5">
      <Link
        to="/"
        className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-card"
        aria-label="חזרה לטיולים"
      >
        <ChevronRight className="size-5" />
      </Link>
      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-sea text-2xl">
        {trip.cover_emoji ?? "🌴"}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-extrabold leading-tight">{trip.title}</h1>
        <p className="truncate text-xs text-muted-foreground">{subtitle ?? trip.destination}</p>
      </div>
      {onShare && (
        <button
          onClick={onShare}
          aria-label="שיתוף"
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-2xl border transition",
            trip.is_shared ? "border-primary bg-primary-soft text-primary" : "border-border bg-card",
          )}
        >
          <Share2 className="size-5" />
        </button>
      )}
    </header>
  );
}

export function ScreenTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}
