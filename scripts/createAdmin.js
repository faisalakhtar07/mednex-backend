import 'dotenv/config'
import connectDB from '../config/db.js'
import User from '../models/User.js'

// Creates (or promotes an existing account to) a platform-level Super Admin.
// There is deliberately no self-service way to become admin — unlike the
// old single-pharmacy version's ADMIN_EMAIL auto-promotion, which stopped
// being safe once 'owner' and 'admin' became separate roles (an owner must
// never get platform-wide access just by matching an email in .env).
//
// Usage:
//   node scripts/createAdmin.js 9999999999 admin@mednex.com "Admin Name" somePassword123
//
// Safe to re-run with the same mobile number — updates the password/name and
// makes sure the role is 'admin' rather than creating a duplicate account.
async function createAdmin() {
  const [, , mobile, email, name, password] = process.argv
  if (!mobile || !password) {
    console.log('Usage: node scripts/createAdmin.js <mobile> <email> <name> <password>')
    process.exit(1)
  }
  if (!/^\d{10}$/.test(mobile)) {
    console.log('Mobile must be exactly 10 digits, no country code or spaces')
    process.exit(1)
  }
  if (password.length < 6) {
    console.log('Password must be at least 6 characters')
    process.exit(1)
  }

  await connectDB()

  let user = await User.findOne({ mobile })
  if (user) {
    user.role = 'admin'
    user.name = name || user.name
    if (email) user.email = email.toLowerCase()
    user.password = password
    await user.save()
    console.log(`✅ Existing account (${mobile}) promoted to admin`)
  } else {
    user = await User.create({ name: name || 'Super Admin', mobile, email: email ? email.toLowerCase() : undefined, password, role: 'admin' })
    console.log(`✅ Admin account created: ${mobile}`)
  }
  process.exit(0)
}

createAdmin().catch((err) => {
  console.error('❌ Could not create admin:', err.message)
  process.exit(1)
})
