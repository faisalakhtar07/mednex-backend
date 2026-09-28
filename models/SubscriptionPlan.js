import mongoose from 'mongoose'

// Config-driven subscription plans (e.g. Basic / Professional / Premium) that
// Super Admin manages from the admin dashboard. Nothing in the UI or backend
// should hardcode plan names, prices, or durations — they all come from here
// so plans can be added/edited/retired without a code change (spec section 4).
const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    durationDays: { type: Number, required: true }, // e.g. 30, 90, 365
    features: [{ type: String }], // display-only bullet list, e.g. "Up to 500 products"
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    // Marks the special one-time 15-day trial plan — kept apart from a
    // regular ₹0 plan an admin might create, because a free-trial plan
    // needs the once-per-doctor rule in routes/subscriptionRoutes.js
    // (POST /start-free-trial), not the normal buy-anytime flow.
    isFreeTrial: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema)
