import mongoose from 'mongoose'
import dns from 'dns'

// Force Node to resolve DNS (including the mongodb+srv:// lookup) via Google's
// public DNS. Some ISPs/routers/mobile hotspots block or mishandle SRV record
// lookups even when the OS's own network settings say to use 8.8.8.8 —
// setting it here, inside Node itself, sidesteps that regardless of which
// network (home WiFi, mobile data, a different office) the server is on.
dns.setServers(['8.8.8.8', '8.8.4.4'])

// Give the driver more room on a slow/flaky connection (mobile hotspot,
// congested WiFi) before it gives up on a single operation or the initial
// server lookup — the defaults are tuned for a stable data-center network,
// not "whatever network this laptop happens to be on right now".
const CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: 15000, // how long to wait for a usable server before failing this attempt
  socketTimeoutMS: 45000, // how long an individual operation can take on a slow link
}

const RETRY_DELAY_MS = 5000 // wait between reconnection attempts — gentle enough not to hammer Atlas, fast enough to recover quickly once the network is back

// Runs forever, in the background — never exits the process. A brief outage
// (WiFi drop, switching networks, ISP hiccup, Atlas maintenance) should
// never take the whole API down; it should just keep trying until the
// database is reachable again, on whatever network the server ends up on.
export default async function connectDB() {
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected — will keep retrying in the background')
  })
  mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected')
  })

  while (true) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, CONNECT_OPTIONS)
      console.log(`✅ MongoDB connected: ${conn.connection.host}`)
      return // success — mongoose's own driver handles staying connected and auto-reconnecting from here
    } catch (err) {
      console.error('❌ MongoDB connection failed:', err.message)
      console.error(`   Retrying in ${RETRY_DELAY_MS / 1000}s... (check MONGO_URI, your network, and that MongoDB/Atlas is reachable)`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}
