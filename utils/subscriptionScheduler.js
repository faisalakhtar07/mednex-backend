import Subscription from '../models/Subscription.js'
import MedicalStore from '../models/MedicalStore.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'

// Runs once a day (see server.js). No new dependency (node-cron etc.) —
// setInterval is enough for a single daily job and keeps the deploy simple.
//
// Two things happen here:
//  1. Any 'active' subscription whose expiryDate has passed gets marked
//     'expired', and its store's subscriptionStatus follows — which
//     automatically removes it from marketplace search (see
//     MedicalStore.isMarketplaceEligible), without deleting any of its data
//     (spec: "Do not delete its data... show the expired status in the
//     owner dashboard... Allow renewal").
//  2. Any 'active' subscription expiring within AdminSettings'
//     subscriptionReminderDaysBefore window gets a reminder notification to
//     the owner (once per matching day — simple day-count match, not a
//     dedupe table, so a reminder can repeat if the cron runs more than
//     once on the same calendar day, which it doesn't under the interval
//     below).
export async function checkSubscriptionExpiries() {
  try {
    const now = new Date()
    const AdminSettings = (await import('../models/AdminSettings.js')).default
    const settings = await AdminSettings.getSettings()

    // --- Auto-expire ---
    const expiring = await Subscription.find({ status: 'active', expiryDate: { $lte: now } })
    const admins = await User.find({ role: 'admin' }).select('_id')

    for (const sub of expiring) {
      sub.status = 'expired'
      await sub.save()
      const store = await MedicalStore.findById(sub.storeId)
      if (!store) continue
      store.subscriptionStatus = 'expired'
      await store.save()

      await Notification.create({
        user: store.ownerId,
        title: 'Subscription Expired',
        message: `Your MedNex subscription has expired — "${store.storeName}" is now hidden from customer search until you renew.`,
        type: 'subscription_expired',
      })
      for (const admin of admins) {
        await Notification.create({
          user: admin._id,
          title: 'Store Subscription Expired',
          message: `"${store.storeName}" subscription just expired and is now hidden from search.`,
          type: 'subscription_expired',
        })
      }
    }

    // --- Reminders ---
    for (const daysBefore of settings.subscriptionReminderDaysBefore) {
      const windowStart = new Date(now)
      windowStart.setDate(windowStart.getDate() + daysBefore)
      windowStart.setHours(0, 0, 0, 0)
      const windowEnd = new Date(windowStart)
      windowEnd.setHours(23, 59, 59, 999)

      const soonToExpire = await Subscription.find({ status: 'active', expiryDate: { $gte: windowStart, $lte: windowEnd } })
      for (const sub of soonToExpire) {
        const store = await MedicalStore.findById(sub.storeId)
        if (!store) continue
        await Notification.create({
          user: store.ownerId,
          title: 'Subscription Expiring Soon',
          message: `"${store.storeName}"'s subscription expires in ${daysBefore} day${daysBefore === 1 ? '' : 's'} — renew from your dashboard to stay visible to customers.`,
          type: 'subscription_expiring',
        })
      }
    }

    if (expiring.length) console.log(`[subscription-check] Auto-expired ${expiring.length} subscription(s)`)
  } catch (err) {
    console.error('[subscription-check] Failed:', err.message)
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function startSubscriptionExpiryScheduler() {
  checkSubscriptionExpiries() // run once immediately on boot
  setInterval(checkSubscriptionExpiries, ONE_DAY_MS)
}
