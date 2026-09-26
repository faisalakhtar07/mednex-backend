import 'dotenv/config'
import connectDB from '../config/db.js'
import { LabTest } from '../models/OtherModels.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import AdminSettings from '../models/AdminSettings.js'

// NOTE: this seed script used to also create a demo medical store, a
// ~15,000-item medicine catalog, and a demo delivery rider — all removed
// along with the medical-store marketplace. What's left is fixture data
// that's still relevant to the Doctor Appointment platform: subscription
// plans (now bought by doctors instead of stores) and lab tests (unrelated
// to the old store business, kept as-is). Doctor accounts are created
// through the real registration flow (POST /api/staff/register with role
// 'doctor'), not seeded here.

// Plan prices/durations — config-driven, not hardcoded anywhere else in the
// app. Same shape as before; now bought by a doctor instead of a store.
const DEMO_PLANS = [
  { name: '1 Month', description: 'Try MedNex risk-free', price: 299, durationDays: 30, features: ['Full doctor profile listing', 'Standard support'] },
  { name: '3 Months', description: 'For an established practice', price: 899, durationDays: 90, features: ['Full doctor profile listing', 'Priority support', 'Booking analytics'] },
  { name: '6 Months', description: 'Best value for growing practices', price: 1599, durationDays: 180, features: ['Everything in 3 Months', 'Featured placement'] },
  { name: '1 Year', description: 'For high-volume clinics', price: 3500, durationDays: 365, features: ['Everything in 6 Months', 'Dedicated support'] },
]

const labTests = [
  { name: 'Full Body Checkup — Essential', category: 'Full Body Checkup', includes: 72, sample: 'Blood', reportTime: '24 hours', mrp: 1999, price: 899, fasting: '10-12 hours fasting required', parameters: ['CBC', 'Liver Function', 'Kidney Function', 'Lipid Profile', 'Thyroid Profile', 'Blood Sugar'] },
  { name: 'Diabetes Screening', category: 'Diabetes', includes: 3, sample: 'Blood', reportTime: '12 hours', mrp: 599, price: 349, fasting: '8 hours fasting required', parameters: ['Fasting Blood Sugar', 'PP Sugar', 'HbA1c'] },
  { name: 'Thyroid Profile Total', category: 'Thyroid', includes: 3, sample: 'Blood', reportTime: '24 hours', mrp: 799, price: 449, fasting: 'No fasting required', parameters: ['T3', 'T4', 'TSH'] },
  { name: 'Liver Function Test', category: 'Liver', includes: 11, sample: 'Blood', reportTime: '24 hours', mrp: 899, price: 499, fasting: 'No fasting required', parameters: ['SGOT', 'SGPT', 'Bilirubin'] },
  { name: 'Kidney Function Test', category: 'Kidney', includes: 8, sample: 'Blood + Urine', reportTime: '24 hours', mrp: 799, price: 449, fasting: 'No fasting required', parameters: ['Creatinine', 'Urea', 'Uric Acid'] },
  { name: 'Vitamin Profile (B12 + D)', category: 'Vitamin Tests', includes: 2, sample: 'Blood', reportTime: '48 hours', mrp: 1899, price: 1299, fasting: 'No fasting required', parameters: ['Vitamin B12', 'Vitamin D'] },
  { name: "Women's Health Panel", category: "Women's Health", includes: 15, sample: 'Blood', reportTime: '24 hours', mrp: 2499, price: 1599, fasting: '8 hours fasting required', parameters: ['CBC', 'Thyroid', 'Iron Studies'] },
  { name: "Men's Health Panel", category: "Men's Health", includes: 18, sample: 'Blood', reportTime: '24 hours', mrp: 2799, price: 1799, fasting: '10 hours fasting required', parameters: ['CBC', 'Lipid Profile', 'PSA'] },
  { name: 'Heart Health Screening', category: 'Heart Health', includes: 6, sample: 'Blood', reportTime: '24 hours', mrp: 1499, price: 999, fasting: '12 hours fasting required', parameters: ['Lipid Profile', 'CRP', 'Homocysteine'] },
]

async function seed() {
  await connectDB()

  for (const plan of DEMO_PLANS) {
    await SubscriptionPlan.updateOne({ name: plan.name }, { $setOnInsert: plan }, { upsert: true })
  }
  await AdminSettings.getSettings() // ensures the singleton settings doc exists with sane defaults

  await LabTest.deleteMany({})
  await LabTest.insertMany(labTests)

  console.log(`✅ Seed complete! ${DEMO_PLANS.length} subscription plans and ${labTests.length} lab tests seeded.`)
  console.log('   Create a Super Admin account with: npm run create-admin <mobile> <email> <name> <password>')
  console.log('   Doctors register themselves via POST /api/staff/register (role: "doctor").')
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
