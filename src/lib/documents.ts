import { supabase } from "./supabase";

export const DOCS_BUCKET = "trip-docs";
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

/**
 * Uploads a file into the private trip-docs bucket and inserts the matching
 * `documents` row. The path must start with the caller's auth uid — the
 * storage policies key off that first segment (see CLAUDE.md).
 *
 * Throws on any failure, including `Error("file_too_large")` for anything over
 * MAX_DOC_BYTES, so each caller can toast in its own words. Shared by
 * DocumentsTab (manual upload + voucher scan) and the Wizard (keeping the
 * original booking files once the trip exists).
 */
export async function uploadTripDocument(opts: {
  userId: string;
  tripId: string;
  file: File;
  category: string;
  participantId?: string | null;
  name?: string;
}): Promise<void> {
  const { userId, tripId, file } = opts;
  if (file.size > MAX_DOC_BYTES) throw new Error("file_too_large");
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${userId}/${tripId}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { upsert: false });
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("documents").insert({
    trip_id: tripId,
    name: opts.name ?? file.name,
    category: opts.category,
    participant_id: opts.participantId || null,
    storage_path: path,
  });
  if (insErr) throw insErr;
}
