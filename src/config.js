// Live-data source.
//
// When WC_API is set to the deployed Cloudflare Worker URL, the app reads the
// cached, bulletproof feed from it (one request per refresh, served to everyone
// from cache). When it's empty, the app falls back to calling ESPN directly
// from the browser — handy for local development before the Worker is deployed.
//
// After `wrangler deploy`, set this to e.g. 'https://worldcup-2026-api.<sub>.workers.dev'
export const WC_API = 'https://worldcup-2026-api.musenailandspa.workers.dev'

// How often to refresh live data while the tab is open (ms).
export const REFRESH_MS = 45000

// Web Push VAPID public key (safe to expose; private key is a Worker secret).
export const VAPID_PUBLIC = 'BB50_RHiHBawxjgCCthJyEZn1stDe9snvx8ta0Nk6oFkTYqF2zL6yvhUNMwb_PbfgRx3_IBvVU2tdumDOtwsme0'
