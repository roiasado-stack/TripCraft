import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True when the app has been pointed at a real Supabase project. */
export const isSupabaseConfigured = Boolean(url && key);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  // Helpful console hint during local setup.
  console.warn(
    "[TripCraft] Supabase is not configured yet. Create a .env file with " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. See README.md.",
  );
}

/**
 * Untyped client on purpose: row shapes are asserted at each call site with the
 * interfaces in ./types, which keeps inserts ergonomic without generated types.
 */
export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  key ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
