import { api } from './api.js'

// Converts the VAPID public key (base64url, from the backend) into the
// Uint8Array shape PushManager.subscribe() requires.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

// Returns the current subscription status: 'unsupported' | 'denied' | 'subscribed' | 'not-subscribed'
export async function getPushStatus() {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  return existing ? 'subscribed' : 'not-subscribed'
}

// Asks the browser for notification permission (if needed), subscribes this
// device to push, and saves the subscription on the backend against the
// logged-in user. Throws with a friendly message on failure so callers can
// toast it.
export async function enablePush() {
  if (!isPushSupported()) throw new Error('Push notifications are not supported on this browser')

  const { configured, publicKey } = await api.getVapidPublicKey()
  if (!configured) throw new Error('Push notifications are not set up on the server yet')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const json = subscription.toJSON()
  await api.subscribePush({ endpoint: json.endpoint, keys: json.keys })
  return subscription
}

// Unsubscribes this device both locally and on the backend.
export async function disablePush() {
  if (!isPushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await api.unsubscribePush(endpoint).catch(() => {}) // best-effort cleanup on the server
}
