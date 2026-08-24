import mongoose from 'mongoose'

// A hand-picked showcase card for the homepage — "MedNex Picks" — managed
// entirely by Super Admin, not pulled automatically from any store's live
// inventory. Optionally linked to a real product/category so tapping it
// takes the customer somewhere useful, but the name/price/image shown here
// are whatever the admin sets, independent of that product's actual
// current price or stock.
const featuredItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    // '#' means "no photo yet" — same convention as regular products (see
    // backend seed.js's NO_IMAGE) — the frontend shows a placeholder icon.
    image: { type: String, default: '#' },
    // Where tapping the card takes the customer — a relative path into the
    // app (e.g. '/category/vitamins', '/medicines/<id>') or a full URL.
    // Optional: an admin can post a pure showcase card with nowhere to go.
    link: { type: String, default: '' },
    order: { type: Number, default: 0 }, // lower shows first
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

featuredItemSchema.index({ active: 1, order: 1 })

export default mongoose.model('FeaturedItem', featuredItemSchema)
