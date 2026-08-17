import { ExternalLink, MapPin, Navigation } from "lucide-react";
import { directionsUrl, isSafeHttpUrl } from "@/lib/maps";
import { cn } from "@/lib/utils";

/** Small inline "open in maps" affordance. Renders nothing without a target. */
export function MapLink({
  url,
  label = "מפה",
  className,
}: {
  url: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!url || !isSafeHttpUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-secondary-foreground",
        className,
      )}
    >
      <MapPin className="size-3.5" />
      {label}
    </a>
  );
}

/** Directions to a place, for things you actually travel to. */
export function DirectionsLink({ place, near }: { place?: string | null; near?: string | null }) {
  const url = directionsUrl(place, near);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
    >
      <Navigation className="size-3.5" />
      ניווט
    </a>
  );
}

/** Generic outbound link chip. */
export function LinkChip({
  url,
  label,
  icon,
}: {
  url: string | null | undefined;
  label: string;
  icon?: React.ReactNode;
}) {
  if (!url || !isSafeHttpUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold"
    >
      {icon ?? <ExternalLink className="size-3.5" />}
      {label}
    </a>
  );
}
