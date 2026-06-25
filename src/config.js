// Live-data source.
//
// When WC_API is set to the deployed Cloudflare Worker URL, the app reads the
// cached, bulletproof feed from it (one request per refresh, served to everyone
// from cache). When it's empty, the app falls back to calling ESPN directly
// from the browser — handy for local development before the Worker is deployed.
//
// After `wrangler deploy`, set this to e.g. 'https://worldcup-2026-api.<sub>.workers.dev'
export const WC_API = ''

// How often to refresh live data while the tab is open (ms).
export const REFRESH_MS = 45000
