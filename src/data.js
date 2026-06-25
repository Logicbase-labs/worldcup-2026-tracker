// ── Views derived from the LIVE feed ────────────────────────────────────────
// No scores are generated here. Everything comes from the real ESPN feed via
// api.js; this module only buckets matches into groups / schedule / knockout
// rounds and computes standings from the real results.

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

export const GROUP_ACCENT = {
  A: ['#f43f5e', '#fb7185'], B: ['#f97316', '#fb923c'], C: ['#eab308', '#facc15'],
  D: ['#84cc16', '#a3e635'], E: ['#22c55e', '#4ade80'], F: ['#10b981', '#34d399'],
  G: ['#06b6d4', '#22d3ee'], H: ['#3b82f6', '#60a5fa'], I: ['#6366f1', '#818cf8'],
  J: ['#8b5cf6', '#a78bfa'], K: ['#d946ef', '#e879f9'], L: ['#ec4899', '#f472b6'],
}

export const ROUND_META = [
  { key: 'r32', title: 'Round of 32', icon: '🎯' },
  { key: 'r16', title: 'Round of 16', icon: '⚔️' },
  { key: 'qf', title: 'Quarter-Finals', icon: '🥊' },
  { key: 'sf', title: 'Semi-Finals', icon: '🔥' },
  { key: 'third', title: 'Third Place', icon: '🥉' },
  { key: 'final', title: 'Final', icon: '🏆' },
]

// Build the three views the UI needs from a flat list of normalized matches.
export function buildViews(matches) {
  const byDate = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date))

  // Groups
  const groups = []
  for (const L of LETTERS) {
    const gm = matches.filter((m) => m.round === 'group' && m.group === L)
    if (!gm.length) continue
    const teams = teamsFrom(gm)
    groups.push({
      letter: L,
      accent: GROUP_ACCENT[L],
      teams,
      matches: [...gm].sort((a, b) => new Date(a.date) - new Date(b.date)),
      standings: computeStandings(teams, gm),
    })
  }

  // Knockout rounds (only those that have fixtures yet)
  const rounds = []
  for (const meta of ROUND_META) {
    const rm = matches.filter((m) => m.round === meta.key)
    if (!rm.length) continue
    rounds.push({ ...meta, matches: [...rm].sort((a, b) => new Date(a.date) - new Date(b.date)) })
  }

  return { groups, rounds, schedule: byDate }
}

function teamsFrom(matches) {
  const map = new Map()
  for (const m of matches) {
    for (const t of [m.home, m.away]) {
      if (t.id && !map.has(t.id)) map.set(t.id, { id: t.id, name: t.name, logo: t.logo, abbrev: t.abbrev })
    }
  }
  return [...map.values()]
}

// Standings from real results (counts only finished matches). FIFA order:
// points, goal difference, goals for, then name as a stable last resort.
export function computeStandings(teams, matches) {
  const row = {}
  teams.forEach((t) => {
    row[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
  })
  matches.forEach((m) => {
    if (m.state !== 'post' || m.home.score == null || m.away.score == null) return
    const h = row[m.home.id]
    const a = row[m.away.id]
    if (!h || !a) return
    h.p++; a.p++
    h.gf += m.home.score; h.ga += m.away.score
    a.gf += m.away.score; a.ga += m.home.score
    if (m.home.score > m.away.score) { h.w++; a.l++; h.pts += 3 }
    else if (m.home.score < m.away.score) { a.w++; h.l++; a.pts += 3 }
    else { h.d++; a.d++; h.pts++; a.pts++ }
  })
  return Object.values(row)
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name))
}

// ── Date / time formatting (always Pacific, labeled PST) ────────────────────
const LA = 'America/Los_Angeles'
export function fmtDate(iso, opts = {}) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: opts.weekday || 'short', month: 'short', day: 'numeric', timeZone: LA,
  })
}
export function fmtTime(iso) {
  const t = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: LA })
  return `${t} PST`
}
export function fmtDayKey(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: LA })
}
