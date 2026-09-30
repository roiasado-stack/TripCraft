/**
 * Business details shown on the legal pages (/terms, /privacy, /credits,
 * /accessibility). Fill these in before public launch — every value still in
 * [brackets] is shown as-is and flagged on the page as "not filled in yet".
 */
export const LEGAL = {
  /** Registered business name (or the owner's full name for an עוסק פטור/מורשה). */
  businessName: "רועי אסדו",
  /** ע.מ / ח.פ number. Empty while the service is run by a private individual; the pages then omit it. */
  businessId: "",
  /** Postal address for legal notices. */
  address: "ירושלים",
  /** Contact address for privacy requests, account questions and legal notices. */
  contactEmail: "Roi.asado@gmail.com",
  /** Accessibility coordinator — name, and a phone or email to reach them. */
  accessibilityContact: "רועי אסדו",
  /** City whose courts have jurisdiction. */
  jurisdictionCity: "ירושלים",
  /** Supabase project region (Dashboard → Project Settings → General). */
  hostingRegion: "אירלנד (AWS eu-west-1)",
  /** How long Supabase keeps backups after a deletion, in days. "0" = the plan keeps no backups
   *  (checked 2026-09-30: no daily backups, no PITR). Update when upgrading the Supabase plan. */
  backupRetention: "0",
  lastUpdated: "26 בספטמבר 2026",
} as const;

export const isPlaceholder = (value: string) => value.startsWith("[");
