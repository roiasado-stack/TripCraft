/*
 * Editable content of the public landing page — the one file to touch when a number or a
 * testimonial changes. Strings are shown as-is, so write them exactly as they should appear.
 */

/**
 * Social-proof stats row. An empty string hides that stat; when all are empty the whole row
 * is hidden. Fill in only real numbers (e.g. tripsBuilt: "120", rating: "4.8/5").
 */
export const LANDING_STATS = {
  tripsBuilt: "", // "<n> טיולים כבר נבנו" — hidden while empty
  agencies: "", // "<n> סוכנויות עובדות איתנו" — hidden while empty
  rating: "", // "<rating> דירוג מטיילים" — hidden while empty
};

/**
 * "מה אומרים עלינו" cards. Empty = the whole block is hidden. There are no real testimonials yet;
 * add them only as real quotes from real people, e.g.
 *   { quote: "…", author: "מטייל, לונדון" }
 */
export const LANDING_TESTIMONIALS: { quote: string; author: string }[] = [];
