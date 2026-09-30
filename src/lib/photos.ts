import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { fetchPlacePhoto, resolvePlaceId, searchPhoto, type PlacePhoto } from "./ai";

/**
 * Photos for places that have no photo of their own.
 *
 * Restaurants and food stops rarely have a Wikipedia article, so the photo
 * lookup (generate kind "photo") finds nothing for them. Instead of an empty
 * gradient they get a curated "ambience" photo by type — never presented as
 * the venue itself (callers mark it "illustrative"). These are Wikimedia
 * Commons Featured/Quality images, hotlinked (not copied) and credited
 * through MediaCard's ⓘ link like every other Wikimedia photo. Chosen to be
 * kashrut-neutral: no pork, shellfish or mixed meat-and-dairy dishes.
 *
 * Display-time only — never written to image_url — so a real photo found
 * later always wins.
 */
const COMMONS = "https://thumb.wikimedia.org/wikipedia/commons/thumb";
const AMBIENT = {
  restaurant: `${COMMONS}/f/f3/Restaurant_room_of_Amantaka_luxury_Resort_%26_Hotel_in_Luang_Prabang_Laos.jpg/1280px-Restaurant_room_of_Amantaka_luxury_Resort_%26_Hotel_in_Luang_Prabang_Laos.jpg`,
  restaurant2: `${COMMONS}/7/72/Restaurant_table_at_Amantaka_luxury_Resort_%26_Hotel_in_Luang_Prabang_Laos.jpg/1280px-Restaurant_table_at_Amantaka_luxury_Resort_%26_Hotel_in_Luang_Prabang_Laos.jpg`,
  cafe: `${COMMONS}/3/35/A_cup_of_coffee_in_Mohk.jpg/1280px-A_cup_of_coffee_in_Mohk.jpg`,
  bakery: `${COMMONS}/3/3b/Home_made_sour_dough_bread.jpg/1280px-Home_made_sour_dough_bread.jpg`,
  dessert: `${COMMONS}/a/a6/Apple_cake_with_vanilla_ice_cream_2.jpg/1280px-Apple_cake_with_vanilla_ice_cream_2.jpg`,
  market: `${COMMONS}/3/33/Onions_Veg_Stall_Ooty_Market_Nilgiris_Aug25_A7CR_07102.jpg/1280px-Onions_Veg_Stall_Ooty_Market_Nilgiris_Aug25_A7CR_07102.jpg`,
  pizza: `${COMMONS}/7/7e/Vegetarian_Pizza.jpg/1280px-Vegetarian_Pizza.jpg`,
} as const;

// First match wins; Hebrew and English, since venue names are often English.
const RULES: [RegExp, keyof typeof AMBIENT][] = [
  [/קפה|coffee|caf[eé]|espresso/i, "cafe"],
  [/גלידה|קינוח|עוג|מתוק|שוקולד|gelato|ice ?cream|dessert|sweet|cake/i, "dessert"],
  [/מאפ|לחם|בייגל|קרואסון|ארוחת בוקר|bakery|bread|breakfast|brunch|bagel/i, "bakery"],
  [/שוק|market|bazaar/i, "market"],
  [/פיצ|איטלק|פסטה|pizza|pasta|trattoria|italian/i, "pizza"],
];

/** An ambience photo for a food place without its own photo, or null when the item isn't food. */
export function ambientPhoto(isFood: boolean, title: string): string | null {
  if (!isFood) return null;
  const hit = RULES.find(([re]) => re.test(title));
  if (hit) return AMBIENT[hit[1]];
  // Two generic restaurant photos, picked by title, so a list of unmatched
  // restaurants doesn't show one image over and over.
  let h = 0;
  for (const ch of title) h = (h + ch.charCodeAt(0)) % 2;
  return h ? AMBIENT.restaurant2 : AMBIENT.restaurant;
}

/**
 * Looks up a photo for every place-like item on the trip that has none —
 * attraction suggestions and activity itinerary items (restaurants get the
 * ambience photo instead). Sequential on purpose: each lookup can make a small
 * AI call, and the generate function's daily cap applies. Returns how many
 * items got a photo.
 */
export async function fillMissingPhotos(tripId: string, destination: string): Promise<number> {
  const [{ data: sugs }, { data: items }] = await Promise.all([
    supabase.from("suggestions").select("id, title").eq("trip_id", tripId).eq("kind", "attraction").is("image_url", null),
    supabase.from("itinerary_items").select("id, title").eq("trip_id", tripId).eq("category", "activity").is("image_url", null),
  ]);
  const jobs = [
    ...((sugs as { id: string; title: string }[]) ?? []).map((r) => ({ ...r, table: "suggestions" })),
    ...((items as { id: string; title: string }[]) ?? []).map((r) => ({ ...r, table: "itinerary_items" })),
  ];
  let filled = 0;
  for (const job of jobs) {
    const url = await searchPhoto(tripId, `${job.title} ${destination}`);
    if (!url) continue;
    const { error } = await supabase.from(job.table).update({ image_url: url }).eq("id", job.id);
    if (!error) filled++;
  }
  return filled;
}

// Session-only: Google's terms forbid storing its photos or photo URLs, so a
// fetched photo lives in memory until the page reloads. Keyed by place ID so a
// card that re-renders doesn't spend another request.
const googlePhotos = new Map<string, Promise<PlacePhoto | null>>();
const resolving = new Map<string, Promise<string | null>>();

/**
 * The photo a suggestion card shows, best first:
 *  1. its stored Wikipedia photo (image_url),
 *  2. a fresh Google photo of the venue, when it has a place ID — editors
 *     resolve and store the ID the first time the card is shown,
 *  3. for restaurants, the ambience photo (labelled illustrative).
 * Attractions without a Wikipedia photo also try Google. Tips and gear don't.
 */
export function useSuggestionPhoto(opts: {
  tripId: string;
  destination: string;
  id: string;
  kind: string;
  title: string;
  imageUrl: string | null;
  placeId: string | null | undefined;
  lat: number | null;
  lng: number | null;
  /** Only editors may write google_place_id (participants can only like). */
  canResolve: boolean;
}): { url: string | null; illustrative: boolean; google: PlacePhoto | null } {
  const isFood = opts.kind === "restaurant";
  const wantsGoogle = !opts.imageUrl && (isFood || opts.kind === "attraction");
  const [google, setGoogle] = useState<PlacePhoto | null>(null);

  useEffect(() => {
    if (!wantsGoogle) return;
    let cancelled = false;
    (async () => {
      let placeId = opts.placeId ?? null;
      if (placeId === null && opts.canResolve) {
        let pending = resolving.get(opts.id);
        if (!pending) {
          pending = resolvePlaceId(opts.tripId, `${opts.title} ${opts.destination}`, { lat: opts.lat, lng: opts.lng }).then(
            async (found) => {
              if (found !== null) await supabase.from("suggestions").update({ google_place_id: found }).eq("id", opts.id);
              return found;
            },
          );
          resolving.set(opts.id, pending);
        }
        placeId = await pending;
      }
      if (!placeId) return;
      let photo = googlePhotos.get(placeId);
      if (!photo) {
        photo = fetchPlacePhoto(opts.tripId, placeId);
        googlePhotos.set(placeId, photo);
      }
      const got = await photo;
      if (!cancelled) setGoogle(got);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id, opts.placeId, wantsGoogle]);

  if (opts.imageUrl) return { url: opts.imageUrl, illustrative: false, google: null };
  if (google) return { url: google.url, illustrative: false, google };
  const ambient = ambientPhoto(isFood, opts.title);
  return { url: ambient, illustrative: !!ambient, google: null };
}
