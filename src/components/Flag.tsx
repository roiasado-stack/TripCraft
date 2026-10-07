import {
  AE, AM, AR, AT, AU, AZ, BE, BG, BR, CA, CH, CN, CU, CY, CZ, DE, DK, EG, ES, FI, FR, GB, GE, GR, HR, HU, ID, IE, IN, IS, IT, JO, JP, KE, KR, LK, MA, ME, MX, NL, NO, NZ, PL, PT, RO, SE, TH, TR, TZ, US, VN, ZA,
} from "country-flag-icons/react/3x2";
import { destinationFlag, flagCountryCode } from "@/lib/trip-options";
import { cn } from "@/lib/utils";

// Bundled SVG flags for every country in DESTINATION_FLAGS. Flag emoji render
// as two letters ("IT") wherever the OS has no flag glyphs (Windows, some
// Android builds), so a known country always gets a real image. Add a country
// here when you add it to DESTINATION_FLAGS.
const FLAGS: Record<string, (props: { className?: string }) => JSX.Element> = {
  AE, AM, AR, AT, AU, AZ, BE, BG, BR, CA, CH, CN, CU, CY, CZ, DE, DK, EG, ES, FI, FR, GB, GE, GR, HR, HU, ID, IE, IN, IS, IT, JO, JP, KE, KR, LK, MA, ME, MX, NL, NO, NZ, PL, PT, RO, SE, TH, TR, TZ, US, VN, ZA,
};

/**
 * The trip's flag: the destination's country when we know it, else the trip's
 * cover emoji, else 🌍. Decorative — the destination is always written nearby.
 * Size it with a width class; the flag keeps its 3:2 shape.
 */
export function Flag({
  destination,
  fallback,
  className,
}: {
  destination: string | null | undefined;
  fallback?: string | null;
  className?: string;
}) {
  const emoji = destinationFlag(destination) ?? fallback ?? null;
  const code = flagCountryCode(emoji);
  const Svg = code ? FLAGS[code] : undefined;
  if (Svg)
    return (
      <span
        aria-hidden
        className={cn("block aspect-[3/2] shrink-0 overflow-hidden rounded-[5px] ring-1 ring-foreground/10", className)}
      >
        <Svg className="block size-full" />
      </span>
    );
  // A flag emoji we have no SVG for would show as letters — use the globe instead.
  // Same box as the flag, so rows line up whichever one renders.
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center", className)}>
      {code ? "🌍" : (emoji ?? "🌍")}
    </span>
  );
}
