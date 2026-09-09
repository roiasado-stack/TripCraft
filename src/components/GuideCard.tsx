import { MessageCircle, UserRound } from "lucide-react";
import type { Trip } from "@/lib/types";
import { whatsappUrl } from "@/lib/maps";
import { Card } from "@/components/ui";

/** Guide contact for an organized trip — renders nothing without a name. */
export function GuideCard({ trip }: { trip: Trip }) {
  if (!trip.guide_name) return null;
  const wa = whatsappUrl(trip.guide_phone);

  return (
    <Card className="mt-4 flex items-center gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
        <UserRound className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-muted-foreground">מדריך הטיול</div>
        <div className="truncate font-bold">{trip.guide_name}</div>
      </div>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-white shadow-soft transition active:scale-95"
        >
          <MessageCircle className="size-4" />
          וואטסאפ
        </a>
      )}
    </Card>
  );
}
