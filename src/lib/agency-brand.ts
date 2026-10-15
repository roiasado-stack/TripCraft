// Agency branding (agency beta, phase 3): the logo an agent uploads to the
// public `agency-logos` bucket (migration 023) and the colour they pick, as
// shown on the public brochure. Both are user-written values that reach
// anonymous visitors, so the page only uses what passes these checks — the
// same checks get_shared_trip already applies on the server.

export const AGENCY_LOGO_BUCKET = "agency-logos";

/** What the bucket accepts (023: allowed_mime_types / file_size_limit). No SVG — it can carry script. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 1024 * 1024;
/** A picked file larger than this is refused before we even try to shrink it. */
export const LOGO_MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Longest side after resizing; the brochure shows it at about 48px. */
export const LOGO_MAX_SIDE = 512;

/** The colour as `#rrggbb`, or null for anything else (a CSS value could load a URL). */
export function safeAgencyColor(color: string | null | undefined): string | null {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/**
 * True when `path` is an image file directly inside one user's folder of the
 * agency-logos bucket (`<uuid>/<name>.png|jpg|jpeg|webp`) — the shape
 * get_shared_trip returns as `agency.logo_path` (023). The brochure builds the
 * URL from our own project with getPublicUrl, so only the path is trusted.
 */
export function isAgencyLogoPath(path: string | null | undefined): path is string {
  return typeof path === "string" && /^[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/i.test(path);
}

/**
 * True when `url` is a logo file (see isAgencyLogoPath) of our own
 * agency-logos bucket. `publicPrefix` is the bucket's public URL ending in "/"
 * (agencyLogoPrefix() at the call site). Used by the settings preview, which
 * reads the URL stored on the profile.
 */
export function isAgencyLogoUrl(url: string | null | undefined, publicPrefix: string): url is string {
  if (typeof url !== "string" || !publicPrefix.endsWith("/") || !url.startsWith(publicPrefix)) return false;
  return isAgencyLogoPath(url.slice(publicPrefix.length));
}

/** The object path (`<uid>/logo-….webp`) of one of our logo URLs, or null. */
export function logoPathFromUrl(url: string | null | undefined, publicPrefix: string): string | null {
  return isAgencyLogoUrl(url, publicPrefix) ? url.slice(publicPrefix.length) : null;
}

/** Where a new logo goes: the uploader's own folder, as the storage policies require. */
export function logoObjectPath(userId: string, timestamp: number, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  return `${userId}/logo-${timestamp}.${ext}`;
}

export type LogoFileProblem = "type" | "too_big";

/** Why a picked file can't be a logo, before resizing (resizing fixes the final size). */
export function logoFileProblem(file: { type: string; size: number }): LogoFileProblem | null {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > LOGO_MAX_INPUT_BYTES) return "too_big";
  return null;
}

/** Width and height that fit inside `max` × `max`, never enlarging. */
export function fitWithin(width: number, height: number, max = LOGO_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
