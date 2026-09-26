/**
 * Business details shown on the legal pages (/terms, /privacy, /credits,
 * /accessibility). Fill these in before public launch — every value still in
 * [brackets] is shown as-is and flagged on the page as "not filled in yet".
 */
export const LEGAL = {
  /** Registered business name (or the owner's full name for an עוסק פטור/מורשה). */
  businessName: "[שם העסק]",
  /** ע.מ / ח.פ number. */
  businessId: "[מספר עוסק / ח.פ]",
  /** Postal address for legal notices. */
  address: "[כתובת למשלוח דואר]",
  /** Contact address for privacy requests, account questions and legal notices. */
  contactEmail: "[כתובת מייל]",
  /** Accessibility coordinator — name, and a phone or email to reach them. */
  accessibilityContact: "[שם רכז/ת הנגישות ודרך ליצירת קשר]",
  /** City whose courts have jurisdiction. */
  jurisdictionCity: "[עיר]",
  /** Supabase project region (Dashboard → Project Settings → General). */
  hostingRegion: "[אזור האחסון של Supabase, למשל: פרנקפורט, גרמניה]",
  /** How long Supabase keeps backups after a deletion. */
  backupRetention: "[מספר ימים]",
  lastUpdated: "26 בספטמבר 2026",
} as const;

export const isPlaceholder = (value: string) => value.startsWith("[");
