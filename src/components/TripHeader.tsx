import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Share2 } from "lucide-react";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Flag } from "@/components/Flag";

/**
 * The trip's navigation bar, pinned to the top of every trip tab. Clear while
 * the page is at the top; once content scrolls under it, it turns into a
 * translucent material with a hairline (the iOS scroll-edge behaviour).
 * Rendered inside each tab's `px-4` wrapper, so it bleeds out with -mx-4.
 */
export function TripHeader({
  trip,
  subtitle,
  onShare,
}: {
  trip: Trip;
  subtitle?: string;
  onShare?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 border-b px-2 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] transition-colors duration-200",
        scrolled ? "material border-separator" : "border-transparent",
      )}
    >
      <Link
        to="/"
        className="grid size-11 shrink-0 place-items-center rounded-full text-primary transition-colors active:bg-muted/70"
        aria-label="חזרה לטיולים"
      >
        <ChevronRight className="size-6" />
      </Link>
      <Flag destination={trip.destination} fallback={trip.cover_emoji} className="w-[30px] text-[22px]" />
      <div className="min-w-0 flex-1 ps-1">
        <h1 className="type-headline line-clamp-2 [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{trip.title}</h1>
        <p className="type-footnote truncate text-muted-foreground">{subtitle ?? trip.destination}</p>
      </div>
      {onShare && (
        <button
          onClick={onShare}
          aria-label={trip.is_shared ? "שיתוף (משותף כעת)" : "שיתוף"}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full transition-colors active:bg-muted/70",
            trip.is_shared ? "bg-primary-soft text-primary" : "text-primary",
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
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="shrink-0 text-xl font-extrabold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}
