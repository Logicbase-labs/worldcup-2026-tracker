import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Trophy, Calendar, CalendarDays, MapPin, ChevronDown, Clock, RotateCcw,
  Eye, EyeOff, Sparkles, Crown, Target, Radio, RefreshCw, AlertTriangle, Check, X,
} from 'lucide-react'
import { loadTournament } from './api.js'
import { REFRESH_MS } from './config.js'
import { buildViews, ROUND_META, fmtDate, fmtTime, fmtDayKey } from './data.js'
import { buildBracket, resolveNodeTeams, winnerTeamOf, realWinnerId, prunePicks, FEEDERS } from './bracket.js'

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
  { key: 'r32', title: 'Round of 32', keys: [...LEAF_ORDER] },
  { key: 'r16', title: 'Round of 16', keys: byDisplay(koRange(8, 'r16')) },
  { key: 'qf', title: 'Quarter-finals', keys: byDisplay(koRange(4, 'qf')) },
  { key: 'sf', title: 'Semi-finals', keys: byDisplay(['sf-1', 'sf-2']) },
  { key: 'final', title: 'Final', keys: ['final'] },
]
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

function BracketTeam({ team, label, score, picked, decided, isWinner, isLost, onPick }) {
  const clickable = team && !decided
  let nameCls = 'text-slate-500'
  if (isWinner) nameCls = 'text-white'
  else if (isLost) nameCls = 'text-slate-600 line-through decoration-slate-600'
  else if (team) nameCls = 'text-slate-200'
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onPick}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition ${clickable ? 'hover:bg-slate-700/40' : ''} ${picked && !decided ? 'bg-violet-500/25 ring-1 ring-violet-400/60' : ''} ${isWinner ? 'bg-emerald-500/15 ring-1 ring-emerald-400/40' : ''}`}
    >
      {team ? <Flag team={team} className="h-3.5 w-5" /> : <span className="h-3.5 w-5 shrink-0 rounded-[2px] bg-slate-700/40" />}
      <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${nameCls}`}>{team ? team.name : label}</span>
      {score != null && <span className="font-mono text-xs font-bold tabular-nums text-slate-300">{score}</span>}
      {picked && !decided && <Sparkles className="h-3 w-3 shrink-0 text-violet-300" />}
      {isWinner && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
    </button>
  )
}

function BracketCell({ nodeKey, nodes, preds, onPick, cache }) {
  const node = nodes[nodeKey]
  if (!node) return null
  const { a, b } = resolveNodeTeams(nodeKey, nodes, preds, cache)
  const winId = realWinnerId(node)
  const decided = !!winId
  const pick = preds[nodeKey]
  const e = node.espn
  const live = e && e.state === 'in'
  const showScore = e && e.state !== 'pre'
  return (
    <div data-node={nodeKey} className={`rounded-lg border bg-slate-900/70 p-1 shadow-sm ${live ? 'border-rose-500/40' : 'border-slate-700/50'}`}>
      <BracketTeam
        team={a} label={slotLabel(node, 'a')} score={showScore ? e.home.score : null}
        picked={pick && a && pick === a.id} decided={decided}
        isWinner={decided && a && winId === a.id} isLost={decided && a && winId !== a.id}
        onPick={() => a && onPick(nodeKey, a.id)}
      />
      <div className="my-0.5 border-t border-slate-700/40" />
      <BracketTeam
        team={b} label={slotLabel(node, 'b')} score={showScore ? e.away.score : null}
        picked={pick && b && pick === b.id} decided={decided}
        isWinner={decided && b && winId === b.id} isLost={decided && b && winId !== b.id}
        onPick={() => b && onPick(nodeKey, b.id)}
      />
      {e && (
        <div className="px-1 pt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          {live ? <span className="text-rose-400">● {e.status || 'Live'}</span> : e.state === 'post' ? (e.status || 'Final') : `${fmtDate(e.date)} · ${fmtTime(e.date)}`}
        </div>
      )}
    </div>
  )
}

function KnockoutView({ nodes, preds, onPick, onReset }) {
  const innerRef = useRef(null)
  const [lines, setLines] = useState([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const compute = () => {
      const ir = el.getBoundingClientRect()
      const pos = (key) => {
        const n = el.querySelector(`[data-node="${key}"]`)
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { left: r.left - ir.left, right: r.right - ir.left, midY: r.top - ir.top + r.height / 2 }
      }
      const segs = []
      for (const key in FEEDERS) {
        if (key === 'third') continue
        const t = pos(key)
        if (!t) continue
        for (const f of FEEDERS[key]) {
          const s = pos(f)
          if (!s) continue
          const mx = (s.right + t.left) / 2
          segs.push({
            id: `${f}-${key}`,
            d: `M${s.right},${s.midY} C${mx},${s.midY} ${mx},${t.midY} ${t.left},${t.midY}`,
            active: !!(preds[f] || (nodes && realWinnerId(nodes[f]))),
          })
        }
      }
      setLines(segs)
      setSvgSize({ w: el.scrollWidth, h: el.scrollHeight })
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    window.addEventListener('resize', compute)
    return () => { ro.disconnect(); window.removeEventListener('resize', compute) }
  }, [nodes, preds])

  if (!nodes) return <Empty>Knockout fixtures will appear here once the bracket is set after the group stage.</Empty>
  const cache = {}
  const champ = winnerTeamOf('final', nodes, preds, cache)
  const allKeys = ROUND_COLS.flatMap((c) => c.keys).concat('third')
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
          <button onClick={onReset} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </div>
      </div>

      <div className="bracket-scroll overflow-auto rounded-2xl border border-slate-700/50 bg-slate-900/30 p-3" style={{ maxHeight: '80vh' }}>
        <div ref={innerRef} className="relative min-w-max" style={{ height: 920 }}>
          <svg className="pointer-events-none absolute left-0 top-0" width={svgSize.w} height={svgSize.h} style={{ zIndex: 0 }}>
            {lines.map((l) => (
              <path key={l.id} d={l.d} fill="none" strokeLinecap="round"
                stroke={l.active ? '#a78bfa' : '#475569'} strokeWidth={l.active ? 2 : 1.4} opacity={l.active ? 0.95 : 0.5} />
            ))}
          </svg>
          <div className="relative flex h-full gap-3 sm:gap-4" style={{ zIndex: 1 }}>
            {ROUND_COLS.map((col) => (
              <div key={col.key} className="flex w-40 shrink-0 flex-col sm:w-44">
                <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">{col.title}</div>
                <div className="flex flex-1 flex-col justify-around gap-2">
                  {col.keys.map((k) => <BracketCell key={k} nodeKey={k} nodes={nodes} preds={preds} onPick={onPick} cache={cache} />)}
                </div>
              </div>
            ))}
          </div>
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
            <UpdatedBadge updatedAt={feed?.updatedAt} stale={feed?.stale} loading={loading} onRefresh={refresh} />
            <LiveClock now={now} />
          </div>
        </div>
      </header>

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
