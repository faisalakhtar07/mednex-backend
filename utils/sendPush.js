import webpush, { isPushConfigured } from '../config/push.js'
import PushSubscription from '../models/PushSubscription.js'

// Sends a browser push notification to every device the given user has
// subscribed on. Silently does nothing if VAPID isn't configured yet — push
// is an enhancement on top of the existing in-app Notification rows
// (models/Notification.js), never a replacement, so a missing/broken
// config here should never break the calling route.
export async function sendPushToUser(userId, { title, body, url }) {
  if (!isPushConfigured()) return
  const subs = await PushSubscription.find({ user: userId })
  if (subs.length === 0) return

  const payload = JSON.stringify({ title, body, url: url || '/' })

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          payload
        )
      } catch (err) {
        // 404/410 = the browser subscription is gone (user cleared site data,
        // uninstalled, etc.) — clean it up so we stop trying forever.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id })
        } else {
          console.error('Push send failed:', err.message)
        }
      }
    })
  )
}
