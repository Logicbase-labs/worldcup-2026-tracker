import { WC_API, VAPID_PUBLIC } from './config.js'

// ── Client side of Web Push ─────────────────────────────────────────────────
const PREFS_KEY = 'wc2026_push_prefs'
const ENDPOINT_KEY = 'wc2026_push_endpoint'
const api = () => WC_API.replace(/\/$/, '')

export const DEFAULT_PREFS = () => ({
  events: { goal: true, kickoff: true, final: true, soon: true },
  scope: 'all',
  teams: [],
})

export function loadPrefs() {
  try { return { ...DEFAULT_PREFS(), ...JSON.parse(localStorage.getItem(PREFS_KEY)) } } catch { return DEFAULT_PREFS() }
}
export function isEnabled() {
  return !!localStorage.getItem(ENDPOINT_KEY) && typeof Notification !== 'undefined' && Notification.permission === 'granted'
}
export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
// iOS only allows push from an installed (Home Screen) PWA.
export function needsInstall() {
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  return iOS && !standalone
}

export async function enableNotifications(prefs) {
  if (!pushSupported()) {
    throw new Error(needsInstall()
      ? 'On iPhone, add this app to your Home Screen first (Share → Add to Home Screen), then enable alerts from there.'
      : 'This browser does not support notifications.')
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Notifications are blocked. Turn them on for this app in your device/browser settings, then try again.'
      : 'Notification permission was not granted.')
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) })
  const j = sub.toJSON()
  const res = await fetch(`${api()}/push/subscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: j, prefs }),
  })
  if (!res.ok) throw new Error('Could not register with the alert server.')
  localStorage.setItem(ENDPOINT_KEY, j.endpoint)
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export async function updatePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  const endpoint = localStorage.getItem(ENDPOINT_KEY)
  if (!endpoint) return
  await fetch(`${api()}/push/prefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, prefs }),
  }).catch(() => {})
}

export async function disableNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    const endpoint = (sub && sub.endpoint) || localStorage.getItem(ENDPOINT_KEY)
    if (sub) await sub.unsubscribe()
    if (endpoint) await fetch(`${api()}/push/unsubscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
  } finally {
    localStorage.removeItem(ENDPOINT_KEY)
  }
}

export async function sendTest() {
  const endpoint = localStorage.getItem(ENDPOINT_KEY)
  if (!endpoint) throw new Error('Enable alerts first.')
  const res = await fetch(`${api()}/push/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
  if (!res.ok) throw new Error('Test failed — try toggling alerts off and on.')
}

function urlB64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
