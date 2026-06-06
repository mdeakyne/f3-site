// Single source of truth for client-side config baked into the static build.
//
// The Turnstile *site key* is public — it ships in the page HTML by design, so
// keeping it in code is fine. (The private *secret key* is never here; it lives
// in the TURNSTILE_SECRET Cloudflare secret used by the Functions.)
//
// To rotate without a code edit, set PUBLIC_TURNSTILE_SITE_KEY at build time
// (e.g. a GitHub Actions env var or a .env file); otherwise this default wins.
export const TURNSTILE_SITE_KEY =
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAAC_IJxiHyXYEjP2U';
