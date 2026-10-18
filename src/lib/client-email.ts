// The client's email on an agent's trip (migration 024): it locks the personal
// join link to the account with that confirmed address. The database compares
// case-insensitively; these helpers keep the screen in step with it.

/** Trimmed and lower-cased, or null when empty. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  return e ? e : null;
}

/** Loose shape check, the same one the trip_invites_lead_check constraint applies. */
export function isValidEmail(raw: string | null | undefined): boolean {
  const e = normalizeEmail(raw);
  return !!e && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

/** Whether a live personal link was made for this address (null = made without one). */
export function sameLeadEmail(linkEmail: string | null | undefined, typed: string | null | undefined): boolean {
  return normalizeEmail(linkEmail) === normalizeEmail(typed);
}
