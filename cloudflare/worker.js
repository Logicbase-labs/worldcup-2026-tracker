// ── World Cup 2026 live-data Worker ─────────────────────────────────────────
// One cached endpoint, GET /tournament, that returns the whole tournament as a
// normalized JSON feed. Source: ESPN's public FIFA World Cup scoreboard (free,
// no key). The Worker fetches each match day, normalizes it, caches the result,
// and serves it to every visitor — so ESPN sees a handful of calls no matter
// how many people open the app, and a brief ESPN outage just serves last-good.
//
// Bulletproofing:
//  - per-day ESPN responses are edge-cached (settled past days for hours, the
//    live day for ~30s) so rebuilds are cheap
//  - the assembled feed is cached ~30s (caches.default) so most visitors get it
//    in a single hop
//  - if a rebuild fails entirely, the last successfully assembled feed is served
//  - CORS open so the static GitHub Pages app can read it from the browser

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const TOURNAMENT_START = '2026-06-11'
const TOURNAMENT_END = '2026-07-19'
const ASSEMBLED_TTL = 30 // seconds
const LA = 'America/Los_Angeles'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'worldcup-2026 live feed', endpoint: '/tournament' })
    }
    if (url.pathname !== '/tournament') return json({ error: 'not found' }, 404)

    const cache = caches.default
    const cacheKey = new Request('https://wc-cache/tournament', request)

    // Serve a warm assembled feed if we have one (covers the common case in 1 hop).
    const hit = await cache.match(cacheKey)
    if (hit && !isExpired(hit)) return withCors(hit)

    try {
      const feed = await buildTournament()
      const res = json(feed)
      res.headers.set('Cache-Control', `public, max-age=${ASSEMBLED_TTL}`)
      // Stash a copy (without the short max-age) as the durable last-good.
      const durable = json(feed)
      durable.headers.set('Cache-Control', 'public, max-age=86400')
      await cache.put(new Request('https://wc-cache/tournament-lastgood'), durable.clone())
      await cache.put(cacheKey, res.clone())
      return withCors(res)
    } catch (err) {
      // ESPN failed — serve the last good feed we ever built, if any.
      const lastGood = await cache.match(new Request('https://wc-cache/tournament-lastgood'))
      if (lastGood) {
        const r = withCors(lastGood)
        r.headers.set('X-Data-Stale', 'true')
        return r
      }
      return json({ error: 'upstream unavailable', detail: String(err) }, 502)
    }
  },
}

async function buildTournament() {
  const today = laDate(new Date())
  const days = dateRange(TOURNAMENT_START, TOURNAMENT_END)
  const results = await Promise.allSettled(days.map((d) => fetchDay(d, today)))
  const matches = []
  for (const r of results) {
    if (r.status === 'fulfilled') matches.push(...r.value)
  }
  // De-dupe by event id (a match can appear in adjacent day windows) and sort.
  const seen = new Set()
  const unique = []
  for (const m of matches) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    unique.push(m)
  }
  unique.sort((a, b) => new Date(a.date) - new Date(b.date))
  return { updatedAt: new Date().toISOString(), count: unique.length, matches: unique }
}

async function fetchDay(dateStr, today) {
  const yyyymmdd = dateStr.replace(/-/g, '')
  const past = dateStr < today
  const res = await fetch(`${ESPN}?dates=${yyyymmdd}`, {
    cf: { cacheTtl: past ? 21600 : 30, cacheEverything: true },
    headers: { 'User-Agent': 'worldcup-2026-tracker' },
  })
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${dateStr}`)
  const data = await res.json()
  return (data.events || []).map(normalize).filter(Boolean)
}

function normalize(event) {
  const comp = (event.competitions && event.competitions[0]) || null
  if (!comp || !comp.competitors || comp.competitors.length < 2) return null
  const note = comp.altGameNote || ''
  const { round, group } = classify(note, event.date)
  const st = (comp.status && comp.status.type) || (event.status && event.status.type) || {}
  const state = st.state || 'pre'
  const home = comp.competitors.find((c) => c.homeAway === 'home') || comp.competitors[0]
  const away = comp.competitors.find((c) => c.homeAway === 'away') || comp.competitors[1]
  return {
    id: event.id,
    date: event.date,
    state, // pre | in | post
    status: st.shortDetail || st.description || '',
    completed: !!st.completed,
    round, // group | r32 | r16 | qf | sf | third | final
    group, // 'A'..'L' for group stage, else null
    venue: {
      stadium: (comp.venue && comp.venue.fullName) || '',
      city: (comp.venue && comp.venue.address && comp.venue.address.city) || '',
    },
    home: team(home, state),
    away: team(away, state),
  }
}

function team(c, state) {
  const t = c.team || {}
  const score = state === 'pre' ? null : c.score != null && c.score !== '' ? Number(c.score) : null
  return {
    id: t.id || null,
    name: t.displayName || t.name || 'TBD',
    abbrev: t.abbreviation || '',
    logo: t.logo || '',
    score,
    winner: !!c.winner,
  }
}

function classify(note, date) {
  const n = note.toLowerCase()
  const g = note.match(/group\s+([a-l])/i)
  if (g) return { round: 'group', group: g[1].toUpperCase() }
  if (n.includes('round of 32')) return { round: 'r32', group: null }
  if (n.includes('round of 16')) return { round: 'r16', group: null }
  if (n.includes('quarter')) return { round: 'qf', group: null }
  if (n.includes('semi')) return { round: 'sf', group: null }
  if (n.includes('third') || n.includes('3rd')) return { round: 'third', group: null }
  if (n.includes('final')) return { round: 'final', group: null }
  return { round: roundByDate(date), group: null }
}

// Fallback when ESPN hasn't labeled the round yet (e.g. bracket not drawn).
function roundByDate(iso) {
  const d = laDate(new Date(iso))
  if (d <= '2026-06-27') return 'group'
  if (d <= '2026-07-03') return 'r32'
  if (d <= '2026-07-07') return 'r16'
  if (d <= '2026-07-11') return 'qf'
  if (d <= '2026-07-15') return 'sf'
  if (d <= '2026-07-18') return 'third'
  return 'final'
}

// ── helpers ─────────────────────────────────────────────────────────────────
function dateRange(start, end) {
  const out = []
  let cur = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10))
    cur = new Date(cur.getTime() + 86400000)
  }
  return out
}
function laDate(d) {
  return d.toLocaleDateString('en-CA', { timeZone: LA }) // YYYY-MM-DD
}
function isExpired(res) {
  const cc = res.headers.get('Cache-Control') || ''
  const age = Number(res.headers.get('Age') || 0)
  const m = cc.match(/max-age=(\d+)/)
  if (!m) return true
  return age >= Number(m[1])
}
function withCors(res) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v)
  return r
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
