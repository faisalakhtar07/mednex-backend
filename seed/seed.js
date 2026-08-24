import 'dotenv/config'
import connectDB from '../config/db.js'
import Product from '../models/Product.js'
import Doctor from '../models/Doctor.js'
import { LabTest } from '../models/OtherModels.js'
import User from '../models/User.js'
import MedicalStore from '../models/MedicalStore.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import Subscription from '../models/Subscription.js'
import AdminSettings from '../models/AdminSettings.js'

const DEMO_OWNER_EMAIL = 'demo-owner@mednex.local'
const DEMO_RIDER_EMAIL = 'demo-rider@mednex.local'
// Plan prices/durations exactly as specified for MedNex — config-driven, not
// hardcoded anywhere else in the app (spec section 4).
const DEMO_PLANS = [
  { name: '1 Month', description: 'Try MedNex risk-free', price: 299, durationDays: 30, features: ['List your full inventory', 'Standard support'] },
  { name: '3 Months', description: 'For an established store', price: 899, durationDays: 90, features: ['List your full inventory', 'Priority support', 'Store analytics'] },
  { name: '6 Months', description: 'Best value for growing stores', price: 1599, durationDays: 180, features: ['Everything in 3 Months', 'Featured placement'] },
  { name: '1 Year', description: 'For high-volume stores', price: 3500, durationDays: 365, features: ['Everything in 6 Months', 'Dedicated support'] },
]

// Creates (or reuses) one demo store so seeded products have somewhere to
// live — the multi-store model requires every Product to have a storeId.
// Real onboarding still goes through POST /api/staff/register -> POST
// /api/stores -> subscription -> admin approval; this is just fixture data.
async function ensureDemoStore() {
  for (const plan of DEMO_PLANS) {
    await SubscriptionPlan.updateOne({ name: plan.name }, { $setOnInsert: plan }, { upsert: true })
  }

  let owner = await User.findOne({ email: DEMO_OWNER_EMAIL })
  if (!owner) {
    owner = await User.create({
      name: 'Demo Store Owner',
      email: DEMO_OWNER_EMAIL,
      mobile: '9999999999',
      password: 'demopassword123',
      role: 'owner',
    })
  }

  let store = await MedicalStore.findOne({ ownerId: owner._id })
  if (!store) {
    const proPlan = await SubscriptionPlan.findOne({ name: '1 Year' })
    store = await MedicalStore.create({
      ownerId: owner._id,
      storeName: 'MedNex Demo Store',
      pharmacistName: 'Demo Pharmacist',
      phone: '9999999999',
      email: DEMO_OWNER_EMAIL,
      state: 'Bihar',
      district: 'Aurangabad',
      city: 'Aurangabad',
      pinCode: '824101',
      verificationStatus: 'approved',
      verifiedAt: new Date(),
    })
    const sub = await Subscription.create({
      storeId: store._id,
      planId: proPlan._id,
      status: 'active',
      startDate: new Date(),
      expiryDate: new Date(Date.now() + proPlan.durationDays * 24 * 60 * 60 * 1000),
    })
    store.subscriptionStatus = 'active'
    store.activeSubscriptionId = sub._id
    await store.save()
  }
  return store
}

// No real product photography ships with this seed data — that's the store
// owner's own to upload (real branded packaging photos are the
// manufacturer's copyrighted material, not something to scrape/hotlink from
// elsewhere). '#' is a deliberate placeholder the frontend recognizes as
// "no photo yet" and renders a category icon for instead — see
// ProductCard.jsx / ProductDetail.jsx.
const NO_IMAGE = '#'

// 32 real Indian pharmaceutical manufacturers — used only as plain-text
// "manufactured by" attribution (factual company names), never their logos
// or packaging artwork.
const brands = [
  'Micro Labs', 'GSK', 'Cipla', 'Abbott', 'Sun Pharma', 'Cadila Healthcare', 'Mankind Pharma',
  'Torrent Pharmaceuticals', 'Alembic Pharmaceuticals', 'Himalaya Wellness', "Dr. Reddy's",
  'Lupin', 'Zydus Lifesciences', 'Intas Pharmaceuticals', 'Aristo Pharmaceuticals',
  'Macleods Pharmaceuticals', 'Glenmark Pharmaceuticals', 'Ipca Laboratories',
  'Emcure Pharmaceuticals', 'Biocon', 'Wockhardt', 'Ajanta Pharma', 'Zuventus Healthcare',
  'FDC Limited', 'USV Private Limited', 'Alkem Laboratories', 'Unichem Laboratories',
  'Indoco Remedies', 'Eris Lifesciences', 'Hetero Drugs', 'Natco Pharma', 'Divis Laboratories',
]

const medicineGenerics = [
  ['Paracetamol', '650mg', 'Pain Relief'], ['Paracetamol', '500mg', 'Pain Relief'],
  ['Ibuprofen', '400mg', 'Pain Relief'], ['Diclofenac', '50mg', 'Pain Relief'],
  ['Aceclofenac', '100mg', 'Pain Relief'], ['Cetirizine', '10mg', 'Allergy'],
  ['Levocetirizine', '5mg', 'Allergy'], ['Montelukast', '10mg', 'Allergy'],
  ['Azithromycin', '500mg', 'Antibiotics'], ['Amoxicillin', '500mg', 'Antibiotics'],
  ['Ciprofloxacin', '500mg', 'Antibiotics'], ['Doxycycline', '100mg', 'Antibiotics'],
  ['Metformin', '500mg', 'Diabetes'], ['Glimepiride', '2mg', 'Diabetes'],
  ['Amlodipine', '5mg', 'Blood Pressure'], ['Losartan', '50mg', 'Blood Pressure'],
  ['Telmisartan', '40mg', 'Blood Pressure'], ['Atorvastatin', '10mg', 'Cholesterol'],
  ['Rosuvastatin', '10mg', 'Cholesterol'], ['Omeprazole', '20mg', 'Acidity'],
  ['Pantoprazole', '40mg', 'Acidity'], ['Ranitidine', '150mg', 'Acidity'],
  ['Domperidone', '10mg', 'Digestive'], ['Ondansetron', '4mg', 'Digestive'],
  ['Loperamide', '2mg', 'Digestive'], ['Ondansetron', '8mg', 'Digestive'],
  ['Naproxen', '250mg', 'Pain Relief'], ['Etoricoxib', '90mg', 'Pain Relief'],
  ['Tramadol', '50mg', 'Pain Relief'], ['Aspirin', '75mg', 'Heart Health'],
  ['Clopidogrel', '75mg', 'Heart Health'], ['Metoprolol', '50mg', 'Blood Pressure'],
  ['Bisoprolol', '5mg', 'Blood Pressure'], ['Furosemide', '40mg', 'Blood Pressure'],
  ['Spironolactone', '25mg', 'Blood Pressure'], ['Sitagliptin', '100mg', 'Diabetes'],
  ['Voglibose', '0.3mg', 'Diabetes'], ['Pioglitazone', '15mg', 'Diabetes'],
  ['Levothyroxine', '50mcg', 'Thyroid'], ['Levothyroxine', '100mcg', 'Thyroid'],
  ['Fluconazole', '150mg', 'Antifungal'], ['Itraconazole', '100mg', 'Antifungal'],
  ['Acyclovir', '400mg', 'Antiviral'], ['Prednisolone', '10mg', 'Anti-inflammatory'],
  ['Dexamethasone', '0.5mg', 'Anti-inflammatory'], ['Ferrous Sulfate', '200mg', 'Anemia Care'],
  ['Folic Acid', '5mg', 'Anemia Care'], ['Calcium Citrate', '500mg', 'Bone Health'],
  ['Alprazolam', '0.25mg', 'Mental Health'], ['Escitalopram', '10mg', 'Mental Health'],
  ['Sertraline', '50mg', 'Mental Health'], ['Amitriptyline', '25mg', 'Mental Health'],
  ['Gabapentin', '300mg', 'Nerve Pain'], ['Pregabalin', '75mg', 'Nerve Pain'],
  ['Rabeprazole', '20mg', 'Acidity'], ['Sucralfate', '1g', 'Acidity'],
  ['Mefenamic Acid', '250mg', 'Pain Relief'], ['Drotaverine', '80mg', 'Digestive'],
  ['Hyoscine', '10mg', 'Digestive'], ['Ambroxol', '30mg', 'Cough & Cold'],
  ['Bromhexine', '8mg', 'Cough & Cold'], ['Dextromethorphan', '10mg', 'Cough & Cold'],
  ['Chlorpheniramine', '4mg', 'Allergy'], ['Fexofenadine', '120mg', 'Allergy'],
  ['Diphenhydramine', '25mg', 'Allergy'], ['Metronidazole', '400mg', 'Antibiotics'],
  ['Cefixime', '200mg', 'Antibiotics'], ['Clindamycin', '300mg', 'Antibiotics'],
  ['Norfloxacin', '400mg', 'Antibiotics'],
]

const vitaminGenerics = [
  ['Vitamin D3', '60000 IU', 'Bone Health'], ['Calcium + D3', '500mg', 'Bone Health'],
  ['Vitamin C', '500mg', 'Immunity'], ['Multivitamin', 'Daily', 'General Wellness'],
  ['Vitamin B12', '1500mcg', 'Nerve Health'], ['Zinc', '50mg', 'Immunity'],
  ['Omega 3 Fish Oil', '1000mg', 'Heart Health'], ['Biotin', '10000mcg', 'Hair & Skin'],
  ['Iron + Folic Acid', '100mg', 'Anemia Care'], ['Probiotic', '10 Billion CFU', 'Gut Health'],
]

const ayurvedaGenerics = [
  ['Ashwagandha', '500mg', 'Stress Relief'], ['Chyawanprash', '500g', 'Immunity'],
  ['Triphala', '500mg', 'Digestive'], ['Giloy', '500mg', 'Immunity'],
  ['Shatavari', '500mg', "Women's Wellness"], ['Brahmi', '500mg', 'Brain Health'],
  ['Amla', '500mg', 'Immunity'], ['Neem', '500mg', 'Skin Health'],
]

// Separate SKUs per pack size are realistic — a real pharmacy sells "strip
// of 10" and "bottle of 60" as different listings, not one product with a
// dropdown. This is also what multiplies the catalog out to ~15,000 items
// without inventing fake drug names.
const packSizeVariants = [
  'Strip of 10 tablets', 'Strip of 15 tablets', 'Bottle of 30 tablets',
  'Bottle of 60 tablets', 'Box of 10 sachets', 'Strip of 6 capsules',
]

const rxCategories = ['Antibiotics', 'Blood Pressure', 'Diabetes', 'Cholesterol', 'Mental Health', 'Antiviral', 'Anti-inflammatory', 'Nerve Pain', 'Thyroid']

function priceFor(seed) {
  const mrp = Math.round((seed % 40) * 12 + 35)
  const price = Math.round(mrp * (0.78 + (seed % 5) * 0.02))
  return { mrp, price }
}

// brandCount/packCount let each category use a different slice of the brand
// list and a different number of pack-size variants, so the final counts
// land close to a realistic ~90/7/5 split of a ~15,000-product catalog
// instead of every category being sized identically.
function buildCatalog(list, category, brandCount, packCount, ratingBase) {
  const products = []
  const catBrands = brands.slice(0, brandCount)
  const catPacks = packSizeVariants.slice(0, packCount)
  let seed = 1
  for (const brand of catBrands) {
    for (const [generic, strength, subcategory] of list) {
      for (const packSize of catPacks) {
        const { mrp, price } = priceFor(seed)
        products.push({
          name: `${brand.split(' ')[0]} ${generic.split(' ')[0]} ${strength}`,
          brand,
          generic: `${generic} ${strength}`,
          category,
          subcategory,
          packSize,
          mrp,
          price,
          rating: +(ratingBase + (seed % 10) * 0.09).toFixed(1),
          reviews: (seed * 37) % 3000,
          prescriptionRequired: category === 'medicines' && rxCategories.includes(subcategory),
          inStock: true,
          stock: 20 + (seed % 180),
          image: NO_IMAGE,
          images: [NO_IMAGE, NO_IMAGE],
          description: `${generic} ${strength} (${packSize}) — commonly used for ${subcategory.toLowerCase()}. Always follow the dosage on the pack or as advised by your doctor/pharmacist.`,
          manufacturer: brand,
          country: 'India',
        })
        seed++
      }
    }
  }
  return products
}

// Sexual Wellness — a standalone, ordinary OTC pharmacy category (spec asks
// for it last in the list, with a discreet/professional presentation, not
// hidden behind any special gate). Items here don't fit the "strip of 10
// tablets" pack-size pattern the medicine catalog uses, so this is a
// separate, deliberately un-multiplied list — exactly 55 items (5 brands x
// 11 product types), not inflated the way medicines/vitamins are.
const sexualWellnessItems = [
  ['Condoms — Ribbed', 'Pack of 10'], ['Condoms — Ultra-thin', 'Pack of 12'],
  ['Condoms — Dotted', 'Pack of 10'], ['Condoms — Flavored', 'Pack of 3'],
  ['Personal Lubricant Gel', '50ml'], ['Personal Lubricant Gel', '100ml'],
  ['Pregnancy Test Kit', 'Pack of 2'], ['Ovulation Test Kit', 'Pack of 5'],
  ['Menstrual Cup', 'Small'], ['Intimate Wash', '100ml'],
  ['Sexual Wellness Supplement', '30 tablets'],
]
const sexualWellnessBrands = ['Cipla', 'Mankind Pharma', 'Himalaya Wellness', 'Emcure Pharmaceuticals', 'USV Private Limited']

function buildSexualWellnessCatalog() {
  const products = []
  let seed = 1
  for (const brand of sexualWellnessBrands) {
    for (const [name, packSize] of sexualWellnessItems) {
      const { mrp, price } = priceFor(seed)
      products.push({
        name: `${brand.split(' ')[0]} ${name}`,
        brand,
        generic: name,
        category: 'sexual-wellness',
        subcategory: 'Sexual Wellness',
        packSize,
        mrp,
        price,
        rating: +(4.0 + (seed % 10) * 0.09).toFixed(1),
        reviews: (seed * 41) % 2000,
        prescriptionRequired: false,
        inStock: true,
        stock: 20 + (seed % 180),
        image: NO_IMAGE,
        images: [NO_IMAGE, NO_IMAGE],
        description: `${name} (${packSize}). Discreet packaging on delivery.`,
        manufacturer: brand,
        country: 'India',
      })
      seed++
    }
  }
  return products
}

// medicines: 32 brands x 69 generics x 6 packs  = 13,248
// vitamins:  21 brands x 10 generics x 5 packs  =  1,050
// ayurveda:  19 brands x  8 generics x 5 packs  =    760
// sexual wellness: 5 brands x 11 items          =     55
// total                                          = 15,113
function buildFullCatalog() {
  return [
    ...buildCatalog(medicineGenerics, 'medicines', 32, 6, 3.9),
    ...buildCatalog(vitaminGenerics, 'vitamins', 21, 5, 4.0),
    ...buildCatalog(ayurvedaGenerics, 'ayurveda', 19, 5, 4.0),
    ...buildSexualWellnessCatalog(),
  ]
}

const doctors = [
  { name: 'Dr. Ananya Sharma', specialization: 'General Physician', experience: '12 years', rating: 4.8, reviews: 640, fee: 299, availableToday: true, nextSlot: '4:30 PM', color: '#0E9C90', phone: '917360800529' },
  { name: 'Dr. Rohan Mehta', specialization: 'Dermatologist', experience: '9 years', rating: 4.7, reviews: 410, fee: 449, availableToday: true, nextSlot: '6:00 PM', color: '#22A96C', phone: '917360800529' },
  { name: 'Dr. Kavita Nair', specialization: 'Pediatrician', experience: '15 years', rating: 4.9, reviews: 890, fee: 399, availableToday: false, nextSlot: 'Tomorrow, 10:00 AM', color: '#FF6B57', phone: '917360800529' },
  { name: 'Dr. Farah Sheikh', specialization: 'Gynecologist', experience: '11 years', rating: 4.8, reviews: 520, fee: 499, availableToday: true, nextSlot: '5:15 PM', color: '#0A7F76', phone: '917360800529' },
  { name: 'Dr. Vikram Rathore', specialization: 'Cardiologist', experience: '18 years', rating: 4.9, reviews: 760, fee: 699, availableToday: false, nextSlot: 'Tomorrow, 11:30 AM', color: '#123A5C', phone: '917360800529' },
  { name: 'Dr. Neha Kapoor', specialization: 'Dentist', experience: '7 years', rating: 4.6, reviews: 310, fee: 349, availableToday: true, nextSlot: '3:00 PM', color: '#2BB8AC', phone: '917360800529' },
  { name: 'Dr. Aditya Kulkarni', specialization: 'Psychiatrist', experience: '10 years', rating: 4.7, reviews: 280, fee: 599, availableToday: true, nextSlot: '7:00 PM', color: '#1B8A58', phone: '917360800529' },
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

// Creates (or reuses) one demo delivery rider, pre-approved so the seeded
// account can go online immediately without a separate admin-verify step.
async function ensureDemoRider() {
  let rider = await User.findOne({ email: DEMO_RIDER_EMAIL })
  if (!rider) {
    rider = await User.create({
      name: 'Demo Delivery Rider',
      email: DEMO_RIDER_EMAIL,
      mobile: '9888888888',
      password: 'demopassword123',
      role: 'delivery',
      deliveryProfile: {
        verificationStatus: 'approved',
        availability: 'offline',
        bankDetails: { accountHolder: 'Demo Rider', accountNumber: '000000000000', ifsc: 'DEMO0000001', upiId: 'demo-rider@upi' },
      },
    })
  }
  return rider
}

async function seed() {
  await connectDB()

  const store = await ensureDemoStore()
  await ensureDemoRider()
  await AdminSettings.getSettings() // ensures the singleton settings doc exists with sane defaults

  const products = buildFullCatalog().map((p) => ({ ...p, storeId: store._id }))

  console.log(`Seeding ${products.length} products for store "${store.storeName}", ${doctors.length} doctors, ${labTests.length} lab tests...`)
  console.log('(Large catalog — this can take a minute or two on a free-tier database.)')

  await Product.deleteMany({ storeId: store._id })
  await Doctor.deleteMany({})
  await LabTest.deleteMany({})

  // insertMany in chunks so one huge single write doesn't hit Atlas
  // free-tier (M0) request-size/timeout limits.
  const CHUNK = 2000
  for (let i = 0; i < products.length; i += CHUNK) {
    await Product.insertMany(products.slice(i, i + CHUNK), { ordered: false })
    console.log(`  ...${Math.min(i + CHUNK, products.length)} / ${products.length} products inserted`)
  }
  await Doctor.insertMany(doctors)
  await LabTest.insertMany(labTests)

  console.log(`✅ Seed complete! ${products.length} products seeded.`)
  console.log(`   Demo owner login:  ${DEMO_OWNER_EMAIL} / demopassword123`)
  console.log(`   Demo rider login:  ${DEMO_RIDER_EMAIL} / demopassword123`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
