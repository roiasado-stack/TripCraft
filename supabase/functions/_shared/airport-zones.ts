// IATA airport code → IANA time zone, for airports with scheduled service.
//
// ~24 KB raw / ~13 KB gzipped, so the web client never imports this statically: it goes
// through `loadZoneOf()` in ./flight-time.ts (a dynamic import, its own Vite chunk), and only
// screens that write a flight need it — readers use the zone stored on the row.
// Edge Functions (Deno) may import it directly.
//
// Data: scripts/gen-airport-zones.mjs → ./airport-zones.data.ts.
import { AIRPORT_ZONES } from "./airport-zones.data.ts";

let index: Map<string, string> | null = null;

/** IANA zone of an airport, or null when the code is unknown. Case-insensitive. */
export function zoneOf(iata: string | null | undefined): string | null {
  if (typeof iata !== "string") return null;
  const code = iata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  if (!index) {
    index = new Map();
    for (const [zone, codes] of Object.entries(AIRPORT_ZONES)) {
      for (const c of codes.split(" ")) index.set(c, zone);
    }
  }
  return index.get(code) ?? null;
}
