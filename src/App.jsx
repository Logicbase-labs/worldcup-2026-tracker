import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Trophy, Calendar, CalendarDays, MapPin, ChevronDown, Clock, RotateCcw,
  Eye, EyeOff, Sparkles, Crown, Target, Radio, RefreshCw, AlertTriangle, Check, X, Share2, Bell,
} from 'lucide-react'
import { loadTournament } from './api.js'
import { REFRESH_MS } from './config.js'
import { enableNotifications, disableNotifications, updatePrefs, sendTest, loadPrefs, isEnabled, pushSupported, needsInstall } from './pushClient.js'
import { buildViews, ROUND_META, fmtDate, fmtTime, fmtDayKey } from './data.js'
import { buildBracket, resolveNodeInfo, winnerTeamOf, realWinnerId, prunePicks, FEEDERS } from './bracket.js'

const PRED_KEY = 'wc2026_bracket_picks'

// ── Shared bits ─────────────────────────────────────────────────────────────
function Flag({ team, className = 'h-4 w-6' }) {
  if (team && team.logo) {
    return (
      <img src={team.logo} alt={team.name} loading="lazy"
        className={`${className} inline-block shrink-0 rounded-[2px] object-contain`} />
    )
  }
  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center rounded-[2px] bg-slate-700 text-[8px] font-bold text-slate-300`}>
      {team && team.abbrev ? team.abbrev.slice(0, 3) : '—'}
    </span>
  )
}

function statusInfo(m) {
  if (m.state === 'in') return { kind: 'live', label: m.status || 'Live' }
  if (m.state === 'post') return { kind: 'final', label: m.status || 'Final' }
  return { kind: 'pre', label: 'Upcoming' }
}

function StatusPill({ m }) {
  const s = statusInfo(m)
  if (s.kind === 'live') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-300 ring-1 ring-rose-500/40">
        <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-rose-400" /> {s.label}
      </span>
    )
  }
  if (s.kind === 'final') {
    return (
      <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-300 ring-1 ring-slate-500/40">
        {s.label}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300 ring-1 ring-sky-500/30">
      Upcoming
    </span>
  )
}

function VenueLine({ m }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {fmtDate(m.date)}</span>
      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {fmtTime(m.date)}</span>
      {m.venue.stadium && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {m.venue.stadium}{m.venue.city ? `, ${m.venue.city}` : ''}
        </span>
      )}
    </div>
  )
}

function ScoreOrVs({ m }) {
  if (m.state === 'pre' || m.home.score == null || m.away.score == null) {
    return <span className="px-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">vs</span>
  }
  const hw = m.home.score > m.away.score
  const aw = m.away.score > m.home.score
  const live = m.state === 'in'
  return (
    <span className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-base font-bold tabular-nums ${live ? 'bg-rose-500/15 ring-1 ring-rose-500/30' : 'bg-slate-900/70'}`}>
      <span className={hw ? 'text-emerald-400' : 'text-slate-200'}>{m.home.score}</span>
      <span className="text-slate-500">:</span>
      <span className={aw ? 'text-emerald-400' : 'text-slate-200'}>{m.away.score}</span>
    </span>
  )
}

// ── Group stage ─────────────────────────────────────────────────────────────
function GroupMatchRow({ m }) {
  const post = m.state === 'post'
  const hw = post && m.home.score > m.away.score
  const aw = post && m.away.score > m.home.score
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <VenueLine m={m} />
        <StatusPill m={m} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`flex flex-1 items-center gap-2 ${hw ? 'font-bold text-white' : 'text-slate-300'}`}>
          <Flag team={m.home} /><span className="truncate">{m.home.name}</span>
        </div>
        <ScoreOrVs m={m} />
        <div className={`flex flex-1 items-center justify-end gap-2 ${aw ? 'font-bold text-white' : 'text-slate-300'}`}>
          <span className="truncate text-right">{m.away.name}</span><Flag team={m.away} />
        </div>
      </div>
    </div>
  )
}

function StandingsTable({ standings, anyPlayed }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-700/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800/70 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-2 py-2 text-left font-semibold">#</th>
            <th className="py-2 text-left font-semibold">Team</th>
            <th className="px-1.5 py-2 text-center font-semibold">P</th>
            <th className="px-1.5 py-2 text-center font-semibold">W</th>
            <th className="px-1.5 py-2 text-center font-semibold">D</th>
            <th className="px-1.5 py-2 text-center font-semibold">L</th>
            <th className="px-1.5 py-2 text-center font-semibold">GD</th>
            <th className="px-2 py-2 text-center font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((r, i) => {
            const qualifies = i < 2
            const playoff = i === 2
            const ptsColor = !anyPlayed ? '#cbd5e1' : qualifies ? '#34d399' : playoff ? '#fbbf24' : '#f87171'
            return (
              <tr key={r.team.id} className={`border-t border-slate-700/40 ${qualifies ? 'bg-emerald-500/[0.07]' : playoff ? 'bg-amber-500/[0.06]' : ''}`}>
                <td className="px-2 py-2">
                  <span className="inline-flex h-5 w-1.5 rounded-full align-middle"
                    style={{ background: qualifies ? '#34d399' : playoff ? '#fbbf24' : 'transparent' }} />
                  <span className="ml-1.5 text-slate-400">{i + 1}</span>
                </td>
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <Flag team={r.team} className="h-3.5 w-5" />
                    <span className="font-medium text-slate-100">{r.team.name}</span>
                  </span>
                </td>
                <td className="px-1.5 py-2 text-center text-slate-300">{r.p}</td>
                <td className="px-1.5 py-2 text-center text-slate-300">{r.w}</td>
                <td className="px-1.5 py-2 text-center text-slate-300">{r.d}</td>
                <td className="px-1.5 py-2 text-center text-slate-300">{r.l}</td>
                <td className="px-1.5 py-2 text-center tabular-nums text-slate-300">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="px-2 py-2 text-center">
                  <span className="font-bold tabular-nums" style={{ color: ptsColor }}>{r.pts}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GroupCard({ group, open, onToggle, showMatches }) {
  const [a1, a2] = group.accent
  const anyPlayed = group.matches.some((m) => m.state === 'post')
  const leader = group.standings[0]
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/50 shadow-lg shadow-black/20 backdrop-blur">
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-slate-800/40"
        style={{ background: `linear-gradient(90deg, ${a1}1f, transparent 70%)` }}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black text-white shadow-md"
          style={{ background: `linear-gradient(135deg, ${a1}, ${a2})` }}>{group.letter}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">Group {group.letter}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {group.teams.map((t) => <Flag key={t.id} team={t} className="h-3 w-[18px]" />)}
          </div>
        </div>
        {anyPlayed && (
          <span className="hidden rounded-full px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30 sm:inline">
            {leader.team.name} {leader.pts}pts
          </span>
        )}
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`collapsible ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="space-y-4 px-4 pb-4 pt-1">
            <StandingsTable standings={group.standings} anyPlayed={anyPlayed} />
            {showMatches && (
              <div className="animate-fade-in space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Group matches</div>
                {group.matches.map((m) => <GroupMatchRow key={m.id} m={m} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function GroupsView({ groups, showCompleted, setShowCompleted }) {
  const [openSet, setOpenSet] = useState(() => new Set())
  const allOpen = openSet.size === groups.length && groups.length > 0
  const toggle = (L) => setOpenSet((s) => { const n = new Set(s); n.has(L) ? n.delete(L) : n.add(L); return n })

  if (!groups.length) {
    return <Empty>Group fixtures haven't been published in the feed yet.</Empty>
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/40 p-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="inline-flex h-3 w-1.5 rounded-full bg-emerald-400" /> Advance
          <span className="ml-2 inline-flex h-3 w-1.5 rounded-full bg-amber-400" /> Best-3rd race
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpenSet(allOpen ? new Set() : new Set(groups.map((g) => g.letter)))}
            className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800">
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          <button onClick={() => setShowCompleted((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showCompleted ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'border border-slate-600/60 text-slate-400 hover:bg-slate-800'}`}>
            {showCompleted ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Matches
          </button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => <GroupCard key={g.letter} group={g} open={openSet.has(g.letter)} onToggle={() => toggle(g.letter)} showMatches={showCompleted} />)}
      </div>
    </div>
  )
}

// ── Schedule ────────────────────────────────────────────────────────────────
function dayLabel(dayKey, todayKey) {
  const diff = Math.round((new Date(`${dayKey}T12:00:00-07:00`) - new Date(`${todayKey}T12:00:00-07:00`)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return null
}

function ScheduleRow({ m }) {
  const post = m.state === 'post'
  const hw = post && m.home.score > m.away.score
  const aw = post && m.away.score > m.home.score
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3 sm:flex-row sm:items-center">
      <div className="flex w-full items-center justify-between gap-2 sm:w-40 sm:flex-col sm:items-start sm:justify-center">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-sm font-bold tabular-nums text-white">
            {new Date(m.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}
          </span>
          <span className="text-[10px] font-bold text-slate-500">PST</span>
        </div>
        {m.round !== 'group' ? (
          <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">{roundLabel(m.round)}</span>
        ) : (
          <span className="rounded-md bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">Group {m.group}</span>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2">
        <div className={`flex flex-1 items-center justify-end gap-2 text-right text-sm ${hw ? 'font-bold text-white' : 'text-slate-200'}`}>
          <span className="truncate">{m.home.name}</span><Flag team={m.home} />
        </div>
        <ScoreOrVs m={m} />
        <div className={`flex flex-1 items-center gap-2 text-sm ${aw ? 'font-bold text-white' : 'text-slate-200'}`}>
          <Flag team={m.away} /><span className="truncate">{m.away.name}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 sm:w-48 sm:justify-end">
        <span className="inline-flex items-center gap-1 truncate text-xs text-slate-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" /> {m.venue.city || m.venue.stadium || ''}
        </span>
        <StatusPill m={m} />
      </div>
    </div>
  )
}

function FeaturedCard({ m }) {
  const live = m.state === 'in'
  return (
    <div className={`rounded-2xl border p-4 shadow-lg ${live ? 'border-rose-500/40 bg-gradient-to-br from-rose-600/15 via-slate-900/40 to-orange-600/10 shadow-rose-900/20' : 'border-sky-500/30 bg-gradient-to-br from-sky-600/15 via-slate-900/40 to-violet-600/10 shadow-sky-900/20'}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{m.round === 'group' ? `Group ${m.group}` : roundLabel(m.round)}</span>
        <StatusPill m={m} />
      </div>
      <div className="flex items-center justify-center gap-3 py-1">
        <div className="flex flex-1 items-center justify-end gap-2 text-right text-base font-bold text-white">
          <span className="truncate">{m.home.name}</span><Flag team={m.home} className="h-5 w-7" />
        </div>
        {m.state === 'pre' ? <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">vs</span> : <ScoreOrVs m={m} />}
        <div className="flex flex-1 items-center gap-2 text-base font-bold text-white">
          <Flag team={m.away} className="h-5 w-7" /><span className="truncate">{m.away.name}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {fmtDate(m.date)}</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {fmtTime(m.date)}</span>
        {m.venue.stadium && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {m.venue.city || m.venue.stadium}</span>}
      </div>
    </div>
  )
}

// All simultaneous live games — or, if none are live, every game at the next
// kickoff time — surfaced as cards at the top of the schedule.
function FeaturedSection({ schedule, now }) {
  const { mode, list, countdown } = useMemo(() => {
    const liveMatches = schedule.filter((m) => m.state === 'in')
    if (liveMatches.length) return { mode: 'live', list: liveMatches, countdown: '' }
    const future = schedule.filter((m) => m.state === 'pre' && new Date(m.date).getTime() >= now - 60000)
    if (!future.length) return { mode: 'none', list: [], countdown: '' }
    const t0 = Math.min(...future.map((m) => +new Date(m.date)))
    const at = future.filter((m) => +new Date(m.date) === t0)
    const hrs = Math.max(0, Math.floor((t0 - now) / 3600000))
    const days = Math.floor(hrs / 24)
    const cd = days > 0 ? `in ${days}d ${hrs % 24}h` : hrs > 0 ? `in ${hrs}h` : 'starting soon'
    return { mode: 'next', list: at, countdown: cd }
  }, [schedule, now])

  if (!list.length) return null
  const live = mode === 'live'
  const grid = list.length === 1 ? '' : list.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide ${live ? 'text-rose-300' : 'text-sky-300'}`}>
          {live ? <Radio className="h-4 w-4 animate-live-pulse" /> : <Clock className="h-4 w-4" />} {live ? 'Live now' : `Up next · ${countdown}`}
        </span>
        {list.length > 1 && <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] font-semibold text-slate-400">{list.length} games</span>}
      </div>
      <div className={`grid gap-3 ${grid}`}>
        {list.map((m) => <FeaturedCard key={m.id} m={m} />)}
      </div>
    </section>
  )
}

function ScheduleView({ schedule, now }) {
  const [showPast, setShowPast] = useState(false)
  const todayKey = fmtDayKey(now)
  const days = useMemo(() => {
    const map = new Map()
    for (const m of schedule) {
      const key = fmtDayKey(m.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(m)
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }))
  }, [schedule])

  const visibleDays = showPast ? days : days.filter((d) => d.key >= todayKey)

  return (
    <div className="space-y-5">
      <FeaturedSection schedule={schedule} now={now} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/40 p-3">
        <p className="text-sm text-slate-300">Every match in kickoff order — <span className="font-semibold text-white">all times PST</span>.</p>
        <button onClick={() => setShowPast((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showPast ? 'bg-slate-700/60 text-slate-200 ring-1 ring-slate-500/40' : 'border border-slate-600/60 text-slate-400 hover:bg-slate-800'}`}>
          {showPast ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Past days
        </button>
      </div>
      {visibleDays.length === 0 ? <Empty>No matches to show.</Empty> : (
        <div className="space-y-6">
          {visibleDays.map((day) => {
            const rel = dayLabel(day.key, todayKey)
            const isToday = day.key === todayKey
            return (
              <section key={day.key}>
                <div className="mb-2.5 flex items-center gap-2">
                  {rel && <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide ${isToday ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'bg-slate-700/50 text-slate-300'}`}>{rel}</span>}
                  <h3 className="text-base font-bold text-white">{fmtDate(day.rows[0].date, { weekday: 'long' })}</h3>
                  <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] font-semibold text-slate-400">{day.rows.length} {day.rows.length === 1 ? 'match' : 'matches'}</span>
                </div>
                <div className="space-y-2">{day.rows.map((m) => <ScheduleRow key={m.id} m={m} />)}</div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Knockouts + predictions ─────────────────────────────────────────────────
function roundLabel(key) {
  const meta = ROUND_META.find((r) => r.key === key)
  return meta ? meta.title : key
}
function koRange(n, p) {
  return Array.from({ length: n }, (_, i) => `${p}-${i + 1}`)
}
// Bracket DISPLAY order: leaves in tree order (so each match sits between the
// two it draws from), giving clean, non-crossing connector lines.
const LEAF_ORDER = (() => {
  const out = []
  ;(function walk(k) {
    if (k.startsWith('r32')) { out.push(k); return }
    const [a, b] = FEEDERS[k]; walk(a); walk(b)
  })('final')
  return out
})()
const LEAF_IDX = Object.fromEntries(LEAF_ORDER.map((k, i) => [k, i]))
function leavesOf(k, acc) {
  if (k.startsWith('r32')) { acc.push(k); return }
  const [a, b] = FEEDERS[k]; leavesOf(a, acc); leavesOf(b, acc)
}
function displayOrd(k) {
  const a = []; leavesOf(k, a)
  return a.reduce((s, x) => s + LEAF_IDX[x], 0) / a.length
}
const byDisplay = (keys) => [...keys].sort((x, y) => displayOrd(x) - displayOrd(y))
const ROUND_COLS = [
  { key: 'r32', title: 'Round of 32' },
  { key: 'r16', title: 'Round of 16' },
  { key: 'qf', title: 'Quarter-finals' },
  { key: 'sf', title: 'Semi-finals' },
  { key: 'final', title: 'Final' },
]

// Fully computed bracket geometry: every match is positioned at the vertical
// midpoint of the two it draws from (true bracket spacing), and connectors are
// orthogonal (horizontal + vertical only). Geometry is static — only the
// highlight state depends on data.
const CELL_W = 172, CELL_H = 56, VGAP = 12, HGAP = 46, HEADER_H = 26
const ROW = CELL_H + VGAP
const COL_INDEX = { r32: 0, r16: 1, qf: 2, sf: 3, final: 4 }
const colX = (round) => COL_INDEX[round] * (CELL_W + HGAP)
const roundOfKey = (k) => k.split('-')[0]
const ALL_NODE_KEYS = [...LEAF_ORDER, ...koRange(8, 'r16'), ...koRange(4, 'qf'), 'sf-1', 'sf-2', 'final']

const LAYOUT = (() => {
  const cy = {}
  LEAF_ORDER.forEach((k, i) => { cy[k] = i * ROW + CELL_H / 2 })
  const roundNodes = { r16: koRange(8, 'r16'), qf: koRange(4, 'qf'), sf: ['sf-1', 'sf-2'], final: ['final'] }
  for (const round of ['r16', 'qf', 'sf', 'final']) {
    for (const key of roundNodes[round]) {
      const [a, b] = FEEDERS[key]
      cy[key] = (cy[a] + cy[b]) / 2
    }
  }
  const pos = {}
  for (const k of ALL_NODE_KEYS) pos[k] = { x: colX(roundOfKey(k)), top: cy[k] - CELL_H / 2 }
  const connectors = []
  for (const round of ['r16', 'qf', 'sf', 'final']) {
    for (const parent of roundNodes[round]) {
      const [a, b] = FEEDERS[parent]
      const childRight = colX(roundOfKey(a)) + CELL_W
      const midX = childRight + HGAP / 2
      const parentLeft = colX(round)
      for (const f of [a, b]) {
        connectors.push({
          f,
          d: `M${childRight},${cy[f]} H${midX} V${cy[parent]} H${parentLeft}`,
          pts: [[childRight, cy[f]], [midX, cy[f]], [midX, cy[parent]], [parentLeft, cy[parent]]],
        })
      }
    }
  }
  const height = (LEAF_ORDER.length - 1) * ROW + CELL_H
  const width = COL_INDEX.final * (CELL_W + HGAP) + CELL_W
  return { pos, connectors, height, width }
})()
function prettyFeeder(key) {
  const [r, n] = key.split('-')
  return `${({ r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF' })[r] || r} ${n}`
}
function slotLabel(node, which) {
  const slot = which === 'a' ? node.slotA : node.slotB
  if (!slot) return 'TBD'
  if (node.round === 'r32') return slot.label || 'TBD'
  return `${slot.side === 'loser' ? 'Loser' : 'Winner'} ${prettyFeeder(slot.feeder)}`
}

function BracketTeam({ team, label, score, source, picked, decided, isWinner, isLost, onPick }) {
  const clickable = team && !decided
  const predicted = source === 'pred' // got here via your prediction (not a real result yet)
  let nameCls = 'text-slate-500'
  if (isWinner) nameCls = 'text-emerald-200'
  else if (isLost) nameCls = 'text-slate-600 line-through decoration-slate-600'
  else if (picked) nameCls = 'text-white'
  else if (predicted) nameCls = 'text-violet-300'
  else if (team) nameCls = 'text-slate-200'
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onPick}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition ${clickable ? 'hover:bg-slate-700/40' : ''} ${picked && !decided ? 'bg-violet-500/25 ring-1 ring-violet-400/60' : ''} ${isWinner ? 'bg-emerald-500/20 ring-1 ring-emerald-400/50' : ''}`}
    >
      {team ? <Flag team={team} className="h-3.5 w-5" /> : <span className="h-3.5 w-5 shrink-0 rounded-[2px] bg-slate-700/40" />}
      <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${nameCls}`}>{team ? team.name : label}</span>
      {score != null && <span className="font-mono text-xs font-bold tabular-nums text-slate-300">{score}</span>}
      {predicted && !picked && !decided && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" title="Your prediction" />}
      {picked && !decided && <Sparkles className="h-3 w-3 shrink-0 text-violet-300" />}
      {isWinner && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
    </button>
  )
}

function BracketCell({ nodeKey, nodes, preds, onPick, cache }) {
  const node = nodes[nodeKey]
  if (!node) return null
  const { a: ai, b: bi } = resolveNodeInfo(nodeKey, nodes, preds, cache)
  const a = ai.team, b = bi.team
  const winId = realWinnerId(node)
  const decided = !!winId
  const pick = preds[nodeKey]
  const e = node.espn
  const live = e && e.state === 'in'
  const showScore = e && e.state !== 'pre'
  return (
    <div data-node={nodeKey} className={`flex h-full flex-col justify-center overflow-hidden rounded-lg border bg-slate-900/80 p-1 shadow-sm ${decided ? 'border-emerald-500/30' : live ? 'border-rose-500/50' : pick ? 'border-violet-500/40' : 'border-slate-700/50'}`}>
      <BracketTeam
        team={a} label={slotLabel(node, 'a')} score={showScore ? e.home.score : null} source={ai.source}
        picked={pick && a && pick === a.id} decided={decided}
        isWinner={decided && a && winId === a.id} isLost={decided && a && winId !== a.id}
        onPick={() => a && onPick(nodeKey, a.id)}
      />
      <div className="my-0.5 border-t border-slate-700/40" />
      <BracketTeam
        team={b} label={slotLabel(node, 'b')} score={showScore ? e.away.score : null} source={bi.source}
        picked={pick && b && pick === b.id} decided={decided}
        isWinner={decided && b && winId === b.id} isLost={decided && b && winId !== b.id}
        onPick={() => b && onPick(nodeKey, b.id)}
      />
    </div>
  )
}

// Render the bracket + the user's predictions to a shareable PNG (canvas, so it
// works offline and avoids cross-origin logo tainting — text-only, branded).
function exportBracketPNG(nodes, preds, champ) {
  const M = 48, TITLE_H = 182, FOOT_H = 72, S = 2
  const W = LAYOUT.width + M * 2
  const H = TITLE_H + LAYOUT.height + FOOT_H
  const cv = document.createElement('canvas')
  cv.width = W * S; cv.height = H * S
  const ctx = cv.getContext('2d')
  ctx.scale(S, S)
  ctx.textBaseline = 'middle'

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0b1120'); bg.addColorStop(0.5, '#10182b'); bg.addColorStop(1, '#0b1120')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W, 0, 0, W, 0, 640)
  glow.addColorStop(0, 'rgba(139,92,246,0.18)'); glow.addColorStop(1, 'rgba(139,92,246,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#ffffff'; ctx.font = '800 40px Inter, sans-serif'
  ctx.fillText('World Cup 2026 — My Bracket', M, 54)
  ctx.font = '700 26px Inter, sans-serif'
  if (champ) { ctx.fillStyle = '#fbbf24'; ctx.fillText(`🏆 My champion: ${champ.name}`, M, 104) }
  else { ctx.fillStyle = '#94a3b8'; ctx.fillText('🏆 Pick your champion', M, 104) }
  const legendY = 146
  const dot = (x, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, legendY, 6, 0, 7); ctx.fill() }
  ctx.font = '600 18px Inter, sans-serif'
  dot(M + 6, '#a78bfa'); ctx.fillStyle = '#cbd5e1'; ctx.fillText('Prediction', M + 20, legendY)
  dot(M + 178, '#34d399'); ctx.fillStyle = '#cbd5e1'; ctx.fillText('Real result', M + 192, legendY)

  const ox = M, oy = TITLE_H

  ctx.lineWidth = 1.6
  for (const c of LAYOUT.connectors) {
    const active = !!(preds[c.f] || realWinnerId(nodes[c.f]))
    ctx.strokeStyle = active ? '#a78bfa' : '#3f4a5e'
    ctx.beginPath()
    c.pts.forEach((p, i) => { const x = ox + p[0], y = oy + p[1]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.stroke()
  }

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }
  const fit = (txt, maxW) => {
    if (ctx.measureText(txt).width <= maxW) return txt
    let t = txt
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
    return t + '…'
  }
  const cache = {}
  for (const k of ALL_NODE_KEYS) {
    const node = nodes[k]; if (!node) continue
    const p = LAYOUT.pos[k]; const x = ox + p.x, y = oy + p.top
    const { a: ai, b: bi } = resolveNodeInfo(k, nodes, preds, cache)
    const winId = realWinnerId(node); const decided = !!winId; const pick = preds[k]
    const e = node.espn; const showScore = e && e.state !== 'pre'
    roundRect(x, y, CELL_W, CELL_H, 8)
    ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = decided ? 'rgba(52,211,153,0.4)' : pick ? 'rgba(139,92,246,0.5)' : 'rgba(71,85,105,0.5)'
    ctx.stroke()
    const row = (info, which, score, cyr) => {
      const team = info.team
      const name = team ? team.name : slotLabel(node, which)
      const isWin = decided && team && winId === team.id
      const isLose = decided && team && winId !== team.id
      const isPick = pick && team && pick === team.id
      let color = '#64748b'
      if (isWin) color = '#6ee7b7'
      else if (isLose) color = '#5b6577'
      else if (isPick) color = '#ffffff'
      else if (info.source === 'pred') color = '#c4b5fd'
      else if (team) color = '#e2e8f0'
      if (isPick && !decided) { roundRect(x + 4, cyr - 12, CELL_W - 8, 24, 5); ctx.fillStyle = 'rgba(139,92,246,0.22)'; ctx.fill() }
      ctx.font = '600 15px Inter, sans-serif'; ctx.fillStyle = color
      const shown = fit(name, CELL_W - 24 - (score != null ? 18 : 0))
      ctx.fillText(shown, x + 10, cyr)
      if (isLose) { const w = ctx.measureText(shown).width; ctx.strokeStyle = '#5b6577'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 10, cyr); ctx.lineTo(x + 10 + w, cyr); ctx.stroke() }
      if (score != null) { ctx.font = '700 15px Inter, sans-serif'; ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right'; ctx.fillText(String(score), x + CELL_W - 8, cyr); ctx.textAlign = 'left' }
    }
    row(ai, 'a', showScore ? e.home.score : null, y + CELL_H * 0.3)
    ctx.strokeStyle = 'rgba(71,85,105,0.35)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x + 6, y + CELL_H / 2); ctx.lineTo(x + CELL_W - 6, y + CELL_H / 2); ctx.stroke()
    row(bi, 'b', showScore ? e.away.score : null, y + CELL_H * 0.7)
  }

  ctx.fillStyle = '#94a3b8'; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'center'
  for (const col of ROUND_COLS) ctx.fillText(col.title.toUpperCase(), ox + colX(col.key) + CELL_W / 2, oy - 16)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#64748b'; ctx.font = '600 17px Inter, sans-serif'
  ctx.fillText('Make your picks + live scores · logicbase-labs.github.io/worldcup-2026-tracker', M, H - 38)

  cv.toBlob(async (blob) => {
    if (!blob) return
    const file = new File([blob], 'my-worldcup-2026-bracket.png', { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'My World Cup 2026 Bracket' }); return } catch (err) { if (err && err.name === 'AbortError') return }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

function KnockoutView({ nodes, preds, onPick, onReset }) {
  if (!nodes) return <Empty>Knockout fixtures will appear here once the bracket is set after the group stage.</Empty>
  const cache = {}
  const champ = winnerTeamOf('final', nodes, preds, cache)
  const allKeys = ALL_NODE_KEYS.concat('third')
  const made = allKeys.filter((k) => preds[k]).length
  let correct = 0, decided = 0
  for (const k of allKeys) {
    const w = realWinnerId(nodes[k])
    if (w && preds[k]) { decided++; if (preds[k] === w) correct++ }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/40 p-3">
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-white">Tap a team to predict</span> — winners flow forward through the bracket.
          {decided > 0 && <span className="ml-1 font-semibold text-emerald-300">{correct}/{decided} correct.</span>}
          {made > 0 && decided === 0 && <span className="ml-1 text-slate-400">{made} {made === 1 ? 'pick' : 'picks'} made.</span>}
        </p>
        <div className="flex items-center gap-2">
          {champ && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200">
              <Crown className="h-4 w-4" /> {champ.name}
            </span>
          )}
          <button onClick={() => exportBracketPNG(nodes, preds, champ)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25">
            <Share2 className="h-4 w-4" /> Share
          </button>
          <button onClick={onReset} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-2 text-xs text-slate-400">
        <span className="font-semibold uppercase tracking-wide text-slate-500">Key:</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-400" /> Your prediction</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Real result</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Qualified team (no pick yet)</span>
      </div>

      <div className="bracket-scroll overflow-auto rounded-2xl border border-slate-700/50 bg-slate-900/30 p-3" style={{ maxHeight: '80vh' }}>
        <div className="relative" style={{ width: LAYOUT.width, height: HEADER_H + LAYOUT.height }}>
          {ROUND_COLS.map((col) => (
            <div key={col.key} className="absolute text-center text-[11px] font-bold uppercase tracking-wide text-slate-400"
              style={{ left: colX(col.key), top: 0, width: CELL_W }}>{col.title}</div>
          ))}
          <svg className="pointer-events-none absolute left-0" style={{ top: HEADER_H, zIndex: 0 }} width={LAYOUT.width} height={LAYOUT.height}>
            {LAYOUT.connectors.map((c, i) => {
              const active = !!(preds[c.f] || realWinnerId(nodes[c.f]))
              return <path key={i} d={c.d} fill="none" stroke={active ? '#a78bfa' : '#475569'} strokeWidth={active ? 2 : 1.4} opacity={active ? 0.95 : 0.5} />
            })}
          </svg>
          {ALL_NODE_KEYS.map((k) => (
            <div key={k} className="absolute" style={{ left: LAYOUT.pos[k].x, top: HEADER_H + LAYOUT.pos[k].top, width: CELL_W, height: CELL_H, zIndex: 1 }}>
              <BracketCell nodeKey={k} nodes={nodes} preds={preds} onPick={onPick} cache={cache} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-3">
        <div className="mb-2 text-sm font-bold text-white">🥉 Third-place play-off</div>
        <div className="max-w-xs">
          <BracketCell nodeKey="third" nodes={nodes} preds={preds} onPick={onPick} cache={cache} />
        </div>
      </div>
    </div>
  )
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function Empty({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center text-sm text-slate-400">{children}</div>
}

function NotifToggle({ on, onClick, label, desc }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 px-3 py-2.5 text-left">
      <span>
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        {desc && <span className="block text-xs text-slate-400">{desc}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-violet-500' : 'bg-slate-600'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
const scopeBtn = (active) => `rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? 'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/50' : 'border border-slate-600/60 text-slate-300 hover:bg-slate-800'}`

function NotificationsModal({ teams, onClose }) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [enabled, setEnabled] = useState(isEnabled())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const supported = pushSupported()
  const install = needsInstall()

  const apply = (next) => { setPrefs(next); if (enabled) updatePrefs(next) }
  const setEvent = (k) => apply({ ...prefs, events: { ...prefs.events, [k]: !prefs.events[k] } })
  const toggleTeam = (id) => apply({ ...prefs, teams: prefs.teams.includes(id) ? prefs.teams.filter((t) => t !== id) : [...prefs.teams, id] })

  const enable = async () => { setBusy(true); setMsg(null); try { await enableNotifications(prefs); setEnabled(true); setMsg({ ok: true, text: 'Alerts are on!' }) } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) } }
  const disable = async () => { setBusy(true); try { await disableNotifications(); setEnabled(false); setMsg(null) } finally { setBusy(false) } }
  const test = async () => { setBusy(true); setMsg(null); try { await sendTest(); setMsg({ ok: true, text: 'Test sent — check your notifications.' }) } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) } }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Bell className="h-5 w-5 text-violet-300" /> Match alerts</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        {!supported ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            {install
              ? 'On iPhone, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on alerts.'
              : 'This browser doesn’t support push notifications.'}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">Get notified about live matches — pick exactly what you want.</p>
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Notify me about</div>
              <div className="space-y-1.5">
                <NotifToggle on={prefs.events.goal} onClick={() => setEvent('goal')} label="⚽ Goals" desc="Score changes in live matches" />
                <NotifToggle on={prefs.events.kickoff} onClick={() => setEvent('kickoff')} label="🔴 Kick-off" desc="When a match starts" />
                <NotifToggle on={prefs.events.final} onClick={() => setEvent('final')} label="🏁 Full time" desc="Final scores" />
                <NotifToggle on={prefs.events.soon} onClick={() => setEvent('soon')} label="⏰ Starting soon" desc="~15 min before kick-off" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">For which matches</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => apply({ ...prefs, scope: 'all' })} className={scopeBtn(prefs.scope === 'all')}>All matches</button>
                <button onClick={() => apply({ ...prefs, scope: 'teams' })} className={scopeBtn(prefs.scope === 'teams')}>Only my teams</button>
              </div>
              {prefs.scope === 'teams' && (
                <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-slate-700/50 bg-slate-800/30 p-2">
                  {teams.length === 0 ? <p className="p-2 text-xs text-slate-400">Teams appear once live data loads.</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {teams.map((t) => (
                        <button key={t.id} onClick={() => toggleTeam(t.id)} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ring-1 ${prefs.teams.includes(t.id) ? 'bg-violet-500/25 text-violet-100 ring-violet-400/50' : 'bg-slate-800/50 text-slate-300 ring-slate-700/60'}`}>
                          {t.logo ? <img src={t.logo} alt="" className="h-3 w-[18px] object-contain" /> : null} {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30' : 'bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30'}`}>{msg.text}</div>}

            {!enabled ? (
              <button disabled={busy} onClick={enable} className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                {busy ? 'Enabling…' : 'Enable alerts'}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30"><Check className="h-4 w-4" /> Alerts are on</div>
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={test} className="rounded-xl border border-slate-600/60 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">Send test</button>
                  <button disabled={busy} onClick={disable} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-60">Turn off</button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-500">On iPhone, alerts require adding the app to your Home Screen. Alerts fire only while you’re subscribed on this device.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function LiveClock({ now }) {
  const time = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/Los_Angeles' })
  const date = new Date(now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 backdrop-blur">
      <span className="h-2 w-2 animate-live-pulse rounded-full bg-emerald-400" />
      <span className="text-xs font-semibold text-slate-300">{date}</span>
      <span className="font-mono text-xs font-bold tabular-nums text-white">{time}</span>
      <span className="text-[10px] font-bold text-slate-500">PST</span>
    </div>
  )
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${active ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/40' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
      {icon}{children}
    </button>
  )
}

function UpdatedBadge({ updatedAt, stale, loading, onRefresh }) {
  const label = updatedAt ? new Date(updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '—'
  return (
    <button onClick={onRefresh} title="Refresh now"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-200">
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      {stale ? <span className="font-semibold text-amber-300">Showing last good data</span> : <>Updated {label} PST</>}
    </button>
  )
}

// ── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('groups')
  const [showCompleted, setShowCompleted] = useState(true)
  const [showUpcoming, setShowUpcoming] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [feed, setFeed] = useState(null) // { updatedAt, matches, stale }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [preds, setPreds] = useState(() => { try { return JSON.parse(localStorage.getItem(PRED_KEY)) || {} } catch { return {} } })
  const [showNotif, setShowNotif] = useState(false)
  const mounted = useRef(true)

  const refresh = useMemo(() => async () => {
    setLoading(true)
    try {
      const data = await loadTournament()
      if (!mounted.current) return
      setFeed(data); setError(null)
    } catch (e) {
      if (!mounted.current) return
      setError(e.message || 'Could not load live data')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    const clock = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, REFRESH_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { mounted.current = false; clearInterval(clock); clearInterval(poll); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  useEffect(() => { localStorage.setItem(PRED_KEY, JSON.stringify(preds)) }, [preds])

  const views = useMemo(() => (feed ? buildViews(feed.matches) : null), [feed])
  const nodes = useMemo(() => (feed && views ? buildBracket(feed.matches, views.groups) : null), [feed, views])
  const teamsList = useMemo(() => {
    if (!views) return []
    const seen = new Map()
    views.groups.forEach((g) => g.teams.forEach((t) => { if (t.id && !seen.has(t.id)) seen.set(t.id, t) }))
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [views])

  const onPick = (nodeKey, teamId) => setPreds((p) => {
    const next = { ...p }
    if (next[nodeKey] === teamId) delete next[nodeKey]
    else next[nodeKey] = teamId
    return nodes ? prunePicks(nodes, next) : next
  })
  const onReset = () => { if (window.confirm('Clear all knockout predictions?')) setPreds({}) }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-2xl shadow-lg shadow-orange-900/40">🏆</div>
            <div>
              <h1 className="text-xl font-black leading-tight text-white sm:text-2xl">World Cup <span className="bg-gradient-to-r from-amber-300 to-rose-400 bg-clip-text text-transparent">2026</span></h1>
              <p className="text-xs text-slate-400">Live scores · Standings · Schedule · Your predictions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNotif(true)} title="Match alerts"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:text-violet-200">
              <Bell className="h-4 w-4" /> Alerts
            </button>
            <UpdatedBadge updatedAt={feed?.updatedAt} stale={feed?.stale} loading={loading} onRefresh={refresh} />
            <LiveClock now={now} />
          </div>
        </div>
      </header>

      {showNotif && <NotificationsModal teams={teamsList} onClose={() => setShowNotif(false)} />}

      <div className="mb-6 grid grid-cols-3 gap-1.5 rounded-2xl border border-slate-700/50 bg-slate-900/50 p-1.5 backdrop-blur sm:inline-grid sm:grid-flow-col">
        <TabButton active={tab === 'groups'} onClick={() => setTab('groups')} icon={<Trophy className="h-4 w-4" />}>Groups</TabButton>
        <TabButton active={tab === 'schedule'} onClick={() => setTab('schedule')} icon={<CalendarDays className="h-4 w-4" />}>Schedule</TabButton>
        <TabButton active={tab === 'knockouts'} onClick={() => setTab('knockouts')} icon={<Target className="h-4 w-4" />}>Knockouts</TabButton>
      </div>

      <main className="animate-fade-in">
        {!views && loading && <Empty><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading live World Cup data…</span></Empty>}
        {!views && error && !loading && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-300" />
            <p className="mb-3 text-sm text-rose-200">Couldn't load live data: {error}</p>
            <button onClick={refresh} className="inline-flex items-center gap-2 rounded-lg bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-200 ring-1 ring-rose-500/40 hover:bg-rose-500/30"><RefreshCw className="h-4 w-4" /> Try again</button>
          </div>
        )}
        {views && (
          <>
            {tab === 'groups' && <GroupsView groups={views.groups} showCompleted={showCompleted} setShowCompleted={setShowCompleted} />}
            {tab === 'schedule' && <ScheduleView schedule={views.schedule} now={now} />}
            {tab === 'knockouts' && <KnockoutView nodes={nodes} preds={preds} onPick={onPick} onReset={onReset} />}
          </>
        )}
      </main>

      <footer className="mt-12 border-t border-slate-800 pt-5 text-center text-xs text-slate-500">
        Live data from ESPN · All times PST · Predictions are yours, saved to this device
      </footer>
    </div>
  )
}
