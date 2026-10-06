import { MessageCircle, UserRound } from "lucide-react";
import type { Trip } from "@/lib/types";
import { whatsappUrl } from "@/lib/maps";
import { cn } from "@/lib/utils";

/** Guide contact for an organized trip — renders nothing without a name. */
export function GuideCard({
  trip,
  className = "mt-4",
}: {
  trip: Pick<Trip, "guide_name" | "guide_phone">;
  className?: string;
}) {
  if (!trip.guide_name) return null;
  const wa = whatsappUrl(trip.guide_phone);

  return (
    <div className={cn("flex items-center gap-3 rounded-2xl bg-card px-4 py-3 text-card-foreground", className)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
        <UserRound className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="type-footnote text-muted-foreground">מדריך הטיול</div>
        {/* The guide's full name matters more than one line — let it wrap. */}
        <div className="type-headline line-clamp-2 [overflow-wrap:anywhere]">{trip.guide_name}</div>
      </div>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`וואטסאפ ל${trip.guide_name}`}
          className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-white"
        >
          <MessageCircle className="size-5" />
        </a>
      )}
    </div>
  );
}
