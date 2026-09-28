import Appointment from '../models/Appointment.js'
import Notification from '../models/Notification.js'
import { sendPushToUser } from './sendPush.js'

// Runs hourly (see server.js). Finds every CONFIRMED appointment whose date
// is tomorrow and hasn't had its reminder yet, then sends an in-app
// notification + browser push to the patient. `reminderSent` on the
// appointment makes it safe to run as often as we like — no duplicates.
// Same no-new-dependency setInterval approach as subscriptionScheduler.js.
export async function sendAppointmentReminders() {
  try {
    // Appointment.date is normalized to midnight UTC, so "tomorrow" is the
    // next UTC calendar day.
    const start = new Date()
    start.setUTCDate(start.getUTCDate() + 1)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setUTCHours(23, 59, 59, 999)

    const due = await Appointment.find({
      status: 'confirmed',
      reminderSent: false,
      date: { $gte: start, $lte: end },
    }).populate('doctorId', 'name clinicName')

    for (const appt of due) {
      const doctorName = appt.doctorId?.name || 'your doctor'
      const message = `Reminder: you have an appointment with ${doctorName} tomorrow${appt.tokenNumber ? ` (token #${appt.tokenNumber})` : ''}.`
      await Notification.create({
        user: appt.patientId,
        title: 'Appointment Tomorrow',
        message,
        type: 'appointment_reminder',
        relatedAppointment: appt._id,
      })
      sendPushToUser(appt.patientId, { title: 'Appointment Tomorrow', body: message, url: '/appointments' }).catch(() => {})
      appt.reminderSent = true
      await appt.save()
    }
    if (due.length) console.log(`[appointment-reminders] Sent ${due.length} reminder(s)`)
  } catch (err) {
    console.error('[appointment-reminders] Failed:', err.message)
  }
}

const ONE_HOUR_MS = 60 * 60 * 1000

export function startAppointmentReminderScheduler() {
  sendAppointmentReminders()
  setInterval(sendAppointmentReminders, ONE_HOUR_MS)
}
