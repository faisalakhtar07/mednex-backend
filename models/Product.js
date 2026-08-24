import mongoose from 'mongoose'

const productSchema = new mongoose.Schema(
  {
    // Every medicine belongs to exactly one store. The same medicine name can
    // exist under many stores as separate documents, each with its own price/
    // stock/status — there is intentionally no shared global inventory record
    // (spec section 7: "Never use one global inventory record that causes one
    // store's stock/price changes to affect another store").
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', required: true, index: true },

    name: { type: String, required: true, trim: true },
    brand: { type: String, required: true },
    generic: { type: String, default: '' },
    category: { type: String, required: true, index: true },
    subcategory: { type: String, default: '' },
    packSize: { type: String, default: '' },
    mrp: { type: Number, required: true },
    price: { type: Number, required: true },
    // Optional store-set promotional price, distinct from `price`. Falls back
    // to `price` on the frontend when not set.
    discountPrice: { type: Number, default: null },
    rating: { type: Number, default: 4.3 },
    reviews: { type: Number, default: 0 },
    prescriptionRequired: { type: Boolean, default: false },
    stock: { type: Number, default: 0 },
    inStock: { type: Boolean, default: true },
    // Lets a store owner deactivate a listing without deleting it (soft-hide),
    // independent of stock count.
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    // Falls back to a category icon on the frontend if empty or '#'.
    // `image` is kept for backward compatibility (always mirrors images[0]);
    // `images` holds up to 2 URLs per product. Real product photography is
    // the store owner's own responsibility to upload — see product-listing
    // routes; this schema never ships with real branded packaging photos.
    image: { type: String, default: '' },
    images: { type: [String], default: [] },
    description: { type: String, default: '' },
    manufacturer: { type: String, default: '' },
    country: { type: String, default: 'India' },
  },
  { timestamps: true }
)

productSchema.index({ name: 'text', brand: 'text', generic: 'text' })
productSchema.index({ storeId: 1, category: 1 })
productSchema.index({ storeId: 1, status: 1 })

export default mongoose.model('Product', productSchema)
