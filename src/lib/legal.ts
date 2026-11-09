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
  contactEmail: "Tripcraft26@gmail.com",
  /** Accessibility coordinator — name, and a phone or email to reach them. */
  accessibilityContact: "רועי אסדו",
  /** City whose courts have jurisdiction. */
  jurisdictionCity: "ירושלים",
  /** Supabase project region (Dashboard → Project Settings → General). */
  hostingRegion: "אירלנד (AWS eu-west-1)",
  /** How long deleted data can survive in backups, in days. "0" = no backups at all. Since
   *  2026-11-09: the encrypted nightly backup in the private repo tripcraft-backups (GitHub
   *  artifacts, retention-days: 30). Supabase Free keeps none. Update if either changes. */
  backupRetention: "30" as string, // widened so the "0" branch on /privacy still type-checks
  lastUpdated: "9 בנובמבר 2026",
} as const;

export const isPlaceholder = (value: string) => value.startsWith("[");
