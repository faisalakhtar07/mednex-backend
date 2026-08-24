import mongoose from 'mongoose'

// A MedicalStore is a single independent medical store/pharmacy operating on
// the marketplace. Every store-scoped resource (Product, Order, Prescription)
// carries a `storeId` pointing back here, and every owner account is tied to
// exactly one store via User owning this document. Delivery riders are NOT
// store-scoped — see User.deliveryProfile and DeliveryAssignment for the
// platform-wide delivery fleet. This is the tenant boundary for the whole
// platform — see middleware/storeAuth.js for how it's enforced on requests.
const medicalStoreSchema = new mongoose.Schema(
  {
    // --- Ownership ---
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // --- Identity ---
    storeName: { type: String, required: true, trim: true },
    pharmacistName: { type: String, default: '' },
    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    logo: { type: String, default: '' },

    // --- Location (Country -> State/UT -> District -> City -> Area -> PIN) ---
    address: { type: String, default: '' },
    country: { type: String, default: 'India' },
    state: { type: String, required: true, index: true }, // State or Union Territory name
    district: { type: String, required: true },
    city: { type: String, required: true },
    area: { type: String, default: '' },
    pinCode: { type: String, required: true, index: true },
    location: {
      // Optional geo point for future "distance from me" sorting. Not required
      // because PIN-code matching (section 3 of the spec) does not depend on it.
      lat: Number,
      lng: Number,
    },

    // --- Compliance ---
    licenseDetails: {
      drugLicenseNumber: { type: String, default: '' },
      drugLicenseDocUrl: { type: String, default: '' },
    },
    gstDetails: {
      gstNumber: { type: String, default: '' },
      gstDocUrl: { type: String, default: '' },
    },
    documents: [{ label: String, url: String }],

    // --- Operating hours ---
    openingTime: { type: String, default: '09:00' }, // "HH:mm" 24h
    closingTime: { type: String, default: '21:00' },

    // --- Platform gatekeeping ---
    // verificationStatus is set by Super Admin review (section 14).
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    verificationNote: { type: String, default: '' }, // reason, shown to owner if rejected
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalized from the store's current Subscription document so
    // marketplace queries (section 4) can filter with a single indexed field
    // instead of a join on every PIN search. Kept in sync by
    // subscriptionRoutes.js / the renewal flow whenever the Subscription changes.
    subscriptionStatus: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    activeSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },

    // Owner can additionally pause the store manually (e.g. going on leave)
    // without touching verification or subscription state.
    isOpen: { type: Boolean, default: true },

    // --- Delivery mode (spec section 8: "Owner Delivery + MedNex Delivery") ---
    // 'mednex': every confirmed order gets broadcast to MedNex's platform-wide
    //   rider fleet — whichever approved+online rider claims it first gets it.
    // 'own': the store manages its own delivery staff (see User.storeId for
    //   'delivery' role accounts scoped to this store) and assigns orders to
    //   them directly — MedNex never touches delivery-fee payout for these,
    //   since the store pays its own riders outside the platform.
    deliveryMode: { type: String, enum: ['mednex', 'own'], default: 'mednex' },

    // Store's own UPI QR code (uploaded once subscription is active) —
    // admin scans this to manually pay out store settlements, since there's
    // no automated bank-transfer integration. Never shown to customers.
    qrCodeUrl: { type: String, default: '' },
    qrCodeUploadedAt: { type: Date, default: null },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

medicalStoreSchema.index({ pinCode: 1, verificationStatus: 1, subscriptionStatus: 1 })
medicalStoreSchema.index({ storeName: 'text' })

// A store is eligible to appear in customer-facing marketplace results only
// when BOTH verification and subscription checks pass. Centralized here so
// every route (PIN search, store page, etc.) applies the exact same rule
// instead of re-implementing it — see spec section 4 and non-negotiable #4.
medicalStoreSchema.methods.isMarketplaceEligible = function () {
  return this.verificationStatus === 'approved' && this.subscriptionStatus === 'active' && this.isOpen
}

medicalStoreSchema.statics.marketplaceEligibleFilter = function (extra = {}) {
  return { verificationStatus: 'approved', subscriptionStatus: 'active', isOpen: true, ...extra }
}

export default mongoose.model('MedicalStore', medicalStoreSchema)
