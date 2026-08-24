import mongoose from 'mongoose'

// A single document holding every admin-configurable business rule referenced
// throughout the spec — "do not hard-code" commission %, delivery rates, and
// payout rules. Every calculation in utils/commission.js reads from this
// instead of a constant, so an admin can change pricing without a deploy.
const adminSettingsSchema = new mongoose.Schema(
  {
    // Singleton marker — there is only ever one document, upserted by key.
    key: { type: String, default: 'default', unique: true },

    // --- Platform commission (spec section 10) ---
    // Percentage of the item total MedNex keeps from every order.
    platformCommissionPercent: { type: Number, default: 12, min: 0, max: 100 },

    // --- Customer-facing delivery fee (spec section 9) ---
    freeDeliveryThreshold: { type: Number, default: 500 }, // order >= this = free delivery
    deliveryFeeTiers: {
      short: { maxDistanceKm: { type: Number, default: 3 }, fee: { type: Number, default: 30 } },
      medium: { maxDistanceKm: { type: Number, default: 7 }, fee: { type: Number, default: 35 } },
      long: { fee: { type: Number, default: 40 } }, // anything beyond medium.maxDistanceKm
    },

    // --- Delivery rider payout (spec section 11) ---
    // Only one of these modes is used at a time, selected by `payoutMode`:
    //  - 'percent': riderEarning = deliveryFee * payoutPercent / 100
    //  - 'fixed': riderEarning = a flat amount per tier (short/medium/long)
    //  - 'distance': same tiers as fixed, just documents intent for future
    //    per-km calculation — falls back to the fixed tier amounts for now.
    payoutMode: { type: String, enum: ['percent', 'fixed', 'distance'], default: 'percent' },
    payoutPercent: { type: Number, default: 7, min: 0, max: 100 }, // used when payoutMode === 'percent'
    payoutTiers: {
      short: { type: Number, default: 22 },
      medium: { type: Number, default: 35 },
      long: { type: Number, default: 45 },
    },
    minPayout: { type: Number, default: 15 }, // floor, applied after either mode above
    maxPayout: { type: Number, default: 100 }, // ceiling, applied after either mode above

    // --- Subscription expiry reminder schedule (spec section 4) ---
    subscriptionReminderDaysBefore: { type: [Number], default: [7, 3, 1] },
  },
  { timestamps: true }
)

adminSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: 'default' })
  if (!settings) settings = await this.create({ key: 'default' })
  return settings
}

export default mongoose.model('AdminSettings', adminSettingsSchema)
