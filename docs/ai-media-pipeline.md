# AI media pipeline (photos, geocoding, dedupe)

Moved out of CLAUDE.md to keep it short. Read this before touching `supabase/functions/generate`, `MediaCard` or `/credits`.

- `generate` also auto-attaches a cover photo (Wikipedia, `kind: "photo"`) and coordinates
  (Nominatim, `kind: "geocode"`) to suggestions/itinerary items — manual add/edit and AI
  generation both go through this, no user-typed URL/coordinates anywhere. Photos are the page
  image of the exact English Wikipedia article for that place (AI items carry `wikipedia_title`;
  `kind: "photo"` asks Claude for the title or NONE). No key, and no search fallback on purpose —
  a miss stays null and shows MediaCard's fallback. Hits are cached in the service-role-only
  `photo_cache` (`wiki:` keys). `UNSPLASH_ACCESS_KEY` is no longer used. Geocoding translates
  Hebrew queries to English first (`translateHebrewQuery`) since Nominatim searches Hebrew badly.
  Wikimedia images carry CC licenses (e.g. CC BY-SA): each image shows an ⓘ link to its file page
  (author + license) via `wikimediaFilePage` in `MediaCard`, plus the `/credits` page.
- Repeated AI presses don't duplicate: `generate` lists the trip's existing suggestions/itinerary
  in the prompt and drops items whose normalized title (`normalizeTitle`) already exists.
