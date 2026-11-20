import { Info } from "lucide-react";
import { LEGAL } from "@/lib/legal";
import { PRIVATE_TRIP_LIMIT_TITLE } from "@/lib/trip-quota";
import { cn } from "@/lib/utils";

/** A private account that already owns its one trip (migration 029). Shown where
 *  "new trip" would be, so nobody starts a wizard or a document scan that can't be saved. */
export function TripLimitNotice({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-2xl bg-card p-4 text-start", className)}>
      <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="type-headline">{PRIVATE_TRIP_LIMIT_TITLE}</p>
        <p className="type-footnote mt-1 text-muted-foreground">
          כדי לפתוח טיול חדש, מחקו את הקודם (בתפריט ⋯ שבכרטיס הטיול) או כתבו לנו:{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-semibold text-primary underline underline-offset-2">
            <bdi>{LEGAL.contactEmail}</bdi>
          </a>
        </p>
      </div>
    </div>
  );
}
