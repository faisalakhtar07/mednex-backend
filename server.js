import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import connectDB from './config/db.js'

import authRoutes from './routes/authRoutes.js'
import miscRoutes from './routes/miscRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import staffAuthRoutes from './routes/staffAuthRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import subscriptionRoutes from './routes/subscriptionRoutes.js'
import doctorRoutes from './routes/doctorRoutes.js'
import appointmentRoutes from './routes/appointmentRoutes.js'
import doctorDashboardRoutes from './routes/doctorDashboardRoutes.js'
import pushRoutes from './routes/pushRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'
import favoriteRoutes from './routes/favoriteRoutes.js'
import { startSubscriptionExpiryScheduler } from './utils/subscriptionScheduler.js'
import { startAppointmentReminderScheduler } from './utils/appointmentReminderScheduler.js'

// The Doctor Appointment System's own routes: doctorRoutes.js (public
// search + a doctor's own profile/registration), appointmentRoutes.js
// (patient booking), doctorDashboardRoutes.js (doctor/staff appointment +
// live token-queue management, tenant-scoped via middleware/doctorAuth.js).

connectDB()

const app = express()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(path.resolve('uploads')))

app.get('/', (req, res) => res.send('MedNex API is running ✅'))

app.use('/api/auth', authRoutes)
app.use('/api', miscRoutes) // /labtests, /labbookings, /prescriptions
app.use('/api/admin', adminRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/staff', staffAuthRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/api/doctors', doctorRoutes)
app.use('/api/appointments', appointmentRoutes)
app.use('/api/doctor-dashboard', doctorDashboardRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/favorites', favoriteRoutes)

app.use((req, res) => res.status(404).json({ message: 'Route not found' }))

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ message: err.message || 'Server error' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 MedNex API running on http://localhost:${PORT}`)
  startSubscriptionExpiryScheduler()
  startAppointmentReminderScheduler()
})
