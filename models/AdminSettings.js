import mongoose from 'mongoose'

// A single document holding admin-configurable business rules. The old
// commission %, delivery-fee tiers, and rider-payout fields were removed
// along with the medical-store marketplace (Order/MedicalStore/delivery
// fleet) — only the subscription reminder schedule (shared by doctor
// subscriptions now) survives from the old settings shape.
const adminSettingsSchema = new mongoose.Schema(
  {
    // Singleton marker — there is only ever one document, upserted by key.
    key: { type: String, default: 'default', unique: true },

    // --- Subscription expiry reminder schedule ---
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
