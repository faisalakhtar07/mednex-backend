import 'dotenv/config'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import MedicalStore from '../models/MedicalStore.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import Subscription from '../models/Subscription.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import { Prescription } from '../models/OtherModels.js'

// One-time migration for databases that were running the old single-pharmacy
// version of this app before the multi-store model existed. It:
//
//   1. Ensures a default SubscriptionPlan exists to attach to legacy stores.
//   2. Creates one MedicalStore per existing 'owner' account that doesn't
//      already have one, pre-approved and pre-subscribed so the store keeps
//      working exactly as it did before (spec: "Do not break existing
//      working features").
//   3. Backfills storeId onto every Product/Order/Prescription that doesn't
//      have one yet, pointing at that store.
//   4. Links any existing legacy 'delivery' accounts to that store — this was
//      correct back when delivery riders were store-owned. That model has
//      since changed twice: riders became platform-wide (deliveryProfile),
//      and then store-owned riders were reintroduced as an explicit,
//      separate 'own' delivery option (deliveryProfile.scope). This step
//      predates both — it clears storeId and resets to a pending
//      platform-fleet rider. If you're migrating a very old database and
//      actually want those legacy riders to become 'own'-scope store staff
//      instead, do that by hand afterward via
//      POST /api/owner/delivery-staff-style updates rather than relying on
//      this script.
//
// Safe to re-run — every step only touches documents missing the field it's
// filling in, so it's a no-op on an already-migrated database.
async function migrate() {
  await connectDB()

  let defaultPlan = await SubscriptionPlan.findOne({ name: 'Legacy' })
  if (!defaultPlan) {
    defaultPlan = await SubscriptionPlan.create({
      name: 'Legacy',
      description: 'Grandfathered plan for stores migrated from the single-pharmacy version.',
      price: 0,
      durationDays: 3650,
      features: ['Migrated store — contact admin to move to a standard plan'],
      status: 'active',
    })
    console.log('Created Legacy subscription plan')
  }

  const owners = await User.find({ role: 'owner' })
  let firstStore = null

  for (const owner of owners) {
    let store = await MedicalStore.findOne({ ownerId: owner._id })
    if (!store) {
      store = await MedicalStore.create({
        ownerId: owner._id,
        storeName: owner.name ? `${owner.name}'s Store` : 'Migrated Store',
        phone: owner.mobile || '0000000000',
        email: owner.email,
        state: 'Bihar',
        district: 'Aurangabad',
        city: 'Aurangabad',
        pinCode: '824101',
        verificationStatus: 'approved',
        verifiedAt: new Date(),
      })
      const sub = await Subscription.create({
        storeId: store._id,
        planId: defaultPlan._id,
        status: 'active',
        startDate: new Date(),
        expiryDate: new Date(Date.now() + defaultPlan.durationDays * 24 * 60 * 60 * 1000),
      })
      store.subscriptionStatus = 'active'
      store.activeSubscriptionId = sub._id
      await store.save()
      console.log(`Created store "${store.storeName}" for owner ${owner.email} — update its location fields via PUT /api/stores/mine`)
    }
    if (!firstStore) firstStore = store
  }

  if (!firstStore) {
    console.log('No owner accounts found — nothing to backfill. Register a store owner first.')
    process.exit(0)
  }

  const productResult = await Product.updateMany({ storeId: { $exists: false } }, { $set: { storeId: firstStore._id } })
  const orderResult = await Order.updateMany({ storeId: { $exists: false } }, { $set: { storeId: firstStore._id } })
  const prescriptionResult = await Prescription.updateMany({ storeId: { $exists: false } }, { $set: { storeId: firstStore._id } })
  const deliveryResult = await User.updateMany(
    { role: 'delivery', storeId: { $ne: null } },
    { $set: { storeId: null, 'deliveryProfile.verificationStatus': 'pending', 'deliveryProfile.availability': 'offline' } }
  )

  console.log(`Backfilled storeId: ${productResult.modifiedCount} products, ${orderResult.modifiedCount} orders, ${prescriptionResult.modifiedCount} prescriptions`)
  console.log(`Migrated ${deliveryResult.modifiedCount} delivery accounts from store-owned to platform-wide (now pending Super Admin verification)`)
  console.log('✅ Migration complete!')
  process.exit(0)
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
