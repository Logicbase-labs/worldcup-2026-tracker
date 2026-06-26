// ── Web Push for the World Cup tracker ──────────────────────────────────────
// Self-contained Web Push (RFC 8291 aes128gcm + VAPID) using WebCrypto so it
// runs on Cloudflare Workers with no dependencies. Plus the subscribe/prefs
// routes and the every-minute watcher that turns live-feed changes into alerts.
//
// Storage (KV binding env.SUBS):
//   sub:<id>        -> { subscription, prefs }
//   state:matches   -> { [matchId]: { st, k, soon } }  (last-seen state for diffing)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

export function defaultPrefs() {
  return { events: { goal: true, kickoff: true, final: true, soon: true }, scope: 'all', teams: [] }
}

// ── Routes (/push/*) ────────────────────────────────────────────────────────
export async function handlePushRoute(request, env) {
  const url = new URL(request.url)
  const p = url.pathname
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (p === '/push/vapid') return json({ publicKey: env.VAPID_PUBLIC || '' })
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405)

  const body = await request.json().catch(() => null)
  if (!body) return json({ error: 'bad body' }, 400)

  if (p === '/push/subscribe') {
    const sub = body.subscription
    if (!sub || !sub.endpoint) return json({ error: 'no subscription' }, 400)
    const id = await endpointId(sub.endpoint)
    await env.SUBS.put(`sub:${id}`, JSON.stringify({ subscription: sub, prefs: body.prefs || defaultPrefs() }))
    return json({ ok: true, id })
  }
  if (p === '/push/prefs') {
    if (!body.endpoint) return json({ error: 'no endpoint' }, 400)
    const id = await endpointId(body.endpoint)
    const cur = await env.SUBS.get(`sub:${id}`, 'json')
    if (!cur) return json({ error: 'not subscribed' }, 404)
    cur.prefs = body.prefs || defaultPrefs()
    await env.SUBS.put(`sub:${id}`, JSON.stringify(cur))
    return json({ ok: true })
  }
  if (p === '/push/unsubscribe') {
    if (!body.endpoint) return json({ error: 'no endpoint' }, 400)
    await env.SUBS.delete(`sub:${await endpointId(body.endpoint)}`)
    return json({ ok: true })
  }
  if (p === '/push/test') {
    if (!body.endpoint) return json({ error: 'no endpoint' }, 400)
    const cur = await env.SUBS.get(`sub:${await endpointId(body.endpoint)}`, 'json')
    if (!cur) return json({ error: 'not subscribed' }, 404)
    const status = await sendPush(cur.subscription, { title: '🏆 Test alert', body: 'Notifications are working!', tag: 'wc-test' }, env).catch((e) => String(e))
    return json({ ok: true, status })
  }
  return json({ error: 'not found' }, 404)
}

// ── Watcher (cron) ──────────────────────────────────────────────────────────
export async function runWatcher(env, matches, now) {
  if (!env.SUBS) return
  const prevRaw = await env.SUBS.get('state:matches')
  const prev = prevRaw ? JSON.parse(prevRaw) : null
  const next = {}
  const events = []
  for (const m of matches) {
    const k = `${m.home.score}-${m.away.score}`
    const startMs = new Date(m.date).getTime()
    const cur = { st: m.state, k, soon: false }
    const p = prev && prev[m.id]
    if (p) {
      cur.soon = p.soon
      if (m.state === 'pre' && !p.soon && startMs - now <= 15 * 60000 && startMs - now > 0) { events.push(mkEvent('soon', m)); cur.soon = true }
      if (p.st === 'pre' && m.state === 'in') events.push(mkEvent('kickoff', m))
      if (p.st === 'in' && m.state === 'in' && p.k !== k) events.push(mkEvent('goal', m))
      if (p.st !== 'post' && m.state === 'post') events.push(mkEvent('final', m))
    }
    next[m.id] = cur
  }
  const nextRaw = JSON.stringify(next)
  if (nextRaw !== prevRaw) await env.SUBS.put('state:matches', nextRaw) // write only on change (KV write budget)
  if (!prev || !events.length) return // first run just seeds state

  const subs = await loadSubs(env)
  for (const e of events) {
    for (const s of subs) {
      const prefs = s.prefs || defaultPrefs()
      if (!prefs.events || !prefs.events[e.type]) continue
      if (prefs.scope === 'teams' && !(prefs.teams || []).some((t) => e.teams.includes(t))) continue
      const status = await sendPush(s.subscription, e.payload, env).catch(() => 0)
      if (status === 404 || status === 410) await env.SUBS.delete(`sub:${s.id}`)
    }
  }
}

function mkEvent(type, m) {
  const h = m.home, a = m.away
  const score = `${h.score}-${a.score}`
  const minute = m.status && /\d/.test(m.status) ? ` (${m.status})` : ''
  let title, bodyText
  if (type === 'goal') { title = '⚽ GOAL'; bodyText = `${h.name} ${score} ${a.name}${minute}` }
  else if (type === 'kickoff') { title = '🔴 Kick-off'; bodyText = `${h.name} vs ${a.name} is under way` }
  else if (type === 'final') { title = '🏁 Full time'; bodyText = `${h.name} ${score} ${a.name}` }
  else { title = '⏰ Starting soon'; bodyText = `${h.name} vs ${a.name} kicks off in ~15 min` }
  return {
    type,
    teams: [h.id, a.id].filter(Boolean),
    payload: { title, body: bodyText, tag: `${m.id}-${type}`, url: '/worldcup-2026-tracker/' },
  }
}

async function loadSubs(env) {
  const out = []
  let cursor
  do {
    const list = await env.SUBS.list({ prefix: 'sub:', cursor })
    for (const key of list.keys) {
      const v = await env.SUBS.get(key.name, 'json')
      if (v && v.subscription) out.push({ id: key.name.slice(4), subscription: v.subscription, prefs: v.prefs })
    }
    cursor = list.list_complete ? null : list.cursor
  } while (cursor)
  return out
}

// ── Web Push send (VAPID + aes128gcm) ───────────────────────────────────────
async function sendPush(sub, payloadObj, env) {
  const body = await encryptPayload(JSON.stringify(payloadObj), sub.keys.p256dh, sub.keys.auth)
  const auth = await vapidAuth(sub.endpoint, env)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '2419200' },
    body,
  })
  return res.status
}

async function encryptPayload(payloadStr, p256dhB64, authB64) {
  const enc = new TextEncoder()
  const uaPublic = b64uToBytes(p256dhB64)
  const authSecret = b64uToBytes(authB64)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const record = concat(enc.encode(payloadStr), new Uint8Array([2])) // 0x02 = last record delimiter
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))

  // header: salt(16) | rs(4=4096) | idlen(1=65) | as_public(65) | ciphertext
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic, ct)
}

async function vapidAuth(endpoint, env) {
  const enc = new TextEncoder()
  const u = new URL(endpoint)
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToB64u(enc.encode(JSON.stringify({
    aud: `${u.protocol}//${u.host}`,
    exp: Math.floor(now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  })))
  const signingInput = `${header}.${payload}`
  const pub = b64uToBytes(env.VAPID_PUBLIC)
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)))
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC}`
}

// ── helpers ─────────────────────────────────────────────────────────────────
function now() { return Date.now() }
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8))
}
function concat(...arrs) {
  let len = 0
  for (const a of arrs) len += a.length
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s + pad)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
}
function bytesToB64u(b) {
  const u = new Uint8Array(b)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function endpointId(endpoint) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))
  return [...d.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
