import { WC_API } from './config.js'

// ── Live tournament feed ────────────────────────────────────────────────────
// Returns { updatedAt, matches } where each match is normalized (see normalize
// below). Uses the Worker when configured, else calls ESPN directly.

const ESPN_DAY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const START = '2026-06-11'
const END = '2026-07-19'

export async function loadTournament() {
  if (WC_API) {
    const res = await fetch(`${WC_API.replace(/\/$/, '')}/tournament`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`feed ${res.status}`)
    const data = await res.json()
    return { updatedAt: data.updatedAt, matches: data.matches || [], stale: res.headers.get('X-Data-Stale') === 'true' }
  }
  // Dev fallback: fetch each match day straight from ESPN in the browser.
  const days = dateRange(START, END)
  const settled = await Promise.allSettled(days.map(fetchEspnDay))
  const seen = new Set()
  const matches = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const m of r.value) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      matches.push(m)
    }
  }
  if (!matches.length) throw new Error('no data from ESPN')
  matches.sort((a, b) => new Date(a.date) - new Date(b.date))
  return { updatedAt: new Date().toISOString(), matches, stale: false }
}

async function fetchEspnDay(dateStr) {
  const res = await fetch(`${ESPN_DAY}?dates=${dateStr.replace(/-/g, '')}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`ESPN ${res.status}`)
  const data = await res.json()
  return (data.events || []).map(normalize).filter(Boolean)
}

// Mirrors the Worker's normalization so both paths produce the same shape.
function normalize(event) {
  const comp = event.competitions && event.competitions[0]
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
    state,
    status: st.shortDetail || st.description || '',
    completed: !!st.completed,
    round,
    group,
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

function roundByDate(iso) {
  const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  if (d <= '2026-06-27') return 'group'
  if (d <= '2026-07-03') return 'r32'
  if (d <= '2026-07-07') return 'r16'
  if (d <= '2026-07-11') return 'qf'
  if (d <= '2026-07-15') return 'sf'
  if (d <= '2026-07-18') return 'third'
  return 'final'
}

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
