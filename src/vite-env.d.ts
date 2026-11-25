/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /** Web push VAPID public key (base64url). Without it Settings hides "turn on notifications". */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Google Analytics 4 measurement ID (G-XXXXXXXXXX). Empty = no Google Analytics. */
  readonly VITE_GA_ID?: string;
  /** Meta Pixel ID. Empty = no Meta Pixel. */
  readonly VITE_META_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
