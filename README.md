# MedNex Backend (Node + Express + MongoDB)

Multi-medical-store marketplace API — every medical store is an independent
tenant with its own inventory, orders, and delivery staff. Runs entirely on
your own laptop, no cloud account needed.

## 1. Install MongoDB Community Server (one-time, on your laptop)

Download & install: https://www.mongodb.com/try/download/community

After installing, MongoDB runs as a background service automatically on
Windows (check Services app for "MongoDB"). If it's not running, open a
terminal and run:
```bash
mongod
```
Keep that terminal open while you use the app (or let it run as a Windows service).

## 2. Install dependencies

```bash
cd mednex-backend
npm install
```

## 3. Check your .env file

A `.env` file is already included with sensible local defaults — see the
comments in that file for what each variable does. If you're upgrading from
an older `medicare` database, note `MONGO_URI` now points at a fresh
`mednex` database name; run the migration script (step 4) to bring old data
across, or just re-seed if you don't need it.

## 4. Seed the database, or migrate existing data

Fresh install (500+ products, 7 doctors, 9 lab tests, one demo store):
```bash
npm run seed
```
Re-running it wipes and recreates that demo store's products/doctors/lab
tests (registered users and their orders are NOT touched).

Upgrading a database that predates the multi-store model:
```bash
npm run migrate
```
Safe to re-run — only backfills documents that are missing `storeId`.

## 5. Create your Super Admin account

There's no auto-promotion by email anymore (that stopped being safe once
`owner` and `admin` became separate roles). Create the first admin from the
command line:
```bash
npm run create-admin -- 9999999999 admin@mednex.com "Admin Name" somePassword123
```
Log in as that account via `POST /api/staff/login` is NOT it — admin login
uses the regular customer-style `POST /api/auth/login` with `mobile` +
`password` (admin is just a `role` on the User model, not a separate staff
flow). This is exactly what the separate `mednex-admin` frontend's login
page calls. Use `/api/admin/*` routes with the resulting token.

## 6. Start the server

```bash
npm run dev
```
You should see:
```
✅ MongoDB connected: 127.0.0.1
🚀 MedNex API running on http://localhost:5000
```

## Roles & how each one authenticates

| Role | How they sign up | How they log in |
|---|---|---|
| Customer | `POST /api/auth/register` — mobile number + password only, no OTP anywhere | `POST /api/auth/login` (mobile + password) |
| Medical Store Owner | `POST /api/staff/register` (`role: 'owner'`) — no access code, open signup | `POST /api/staff/login` (`role: 'owner'`) |
| Delivery Rider | `POST /api/staff/register` (`role: 'delivery'`), no access code | `POST /api/staff/login` (`role: 'delivery'`) |
| Super Admin | `npm run create-admin` (CLI only) | `POST /api/auth/login` |

A store owner registers their **account** first, then separately registers
their **store** (`POST /api/stores`) — the store stays hidden from customers
until a Super Admin approves it AND its subscription is active.

A delivery rider registers their **account**, but can't go online
(`PUT /api/delivery/availability`) until Super Admin sets their
`deliveryProfile.verificationStatus` to `approved` — MedNex runs one shared
delivery fleet across every store, riders aren't tied to any single store.

## Order & delivery flow

Every store picks a delivery mode **per order**, not just once (spec section
8: "Owner Delivery + MedNex Delivery"):

```
Customer places order (Pending)
  -> Store owner confirms (PUT /api/owner/orders/:id/confirm)
       Body: { deliveryMode: 'own' | 'mednex', deliveryBoyId? }
       - generates a pickup code (returned once, to the owner)

       'own'    -> assigned directly to one of the store's own riders
                   (deliveryBoyId required, must be that store's staff)
       'mednex' -> broadcast to EVERY online+approved platform rider at
                   once — first to claim it (PUT /api/delivery/assignments/:id/claim)
                   gets it, atomically (no two riders can claim the same one)
     ...or rejects (PUT /api/owner/orders/:id/reject) with a reason
  -> Rider accepts (PUT /api/delivery/assignments/:id/accept)
  -> Rider marks "Going to Store" / "Reached Store"
  -> Rider enters the pickup code the owner reads out
     (PUT /api/delivery/assignments/:id/verify-pickup)
  -> Rider marks "Going to Customer" / "Reached Customer"
  -> Rider enters the customer-facing delivery OTP to complete
     (PUT /api/delivery/assignments/:id/deliver)
       - this is where StoreSettlement is computed and locked in
```

The owner never has a "mark delivered" action regardless of mode — once they
confirm, delivery (their own team or MedNex's fleet) takes over completely.

Money differs by mode too (see `utils/commission.js`): in `'mednex'` mode,
MedNex pays the rider and keeps the delivery fee; in `'own'` mode, MedNex
never touches rider pay — the full delivery fee is credited back to the
store's settlement instead, since the store pays its own rider directly.

A rider's own `deliveryProfile.scope` (`'platform'` or `'store'`) determines
which pool they're in — platform riders self-register and see the broadcast
pool; store riders are created by their owner (`POST /api/owner/delivery-staff`)
and only ever receive orders that owner assigns directly.

## Key API routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | — | Customer signup — mobile + password |
| POST | /api/auth/login | — | Customer login — mobile + password |
| POST | /api/auth/password/reset-direct | — | Forgot password — mobile number, no verification step (see note below) |
| POST | /api/stores | ✅ owner | Register a medical store |
| GET/PUT | /api/stores/mine | ✅ owner | View/edit own store profile |
| PUT | /api/stores/:id/verify | ✅ admin | Approve/reject a store |
| GET | /api/products?storeId=... | — | Browse one store's medicines |
| POST | /api/orders | ✅ customer | Place an order with a specific store (fee computed server-side) |
| GET | /api/owner/orders | ✅ owner | This store's orders only |
| PUT | /api/owner/orders/:id/confirm | ✅ owner | Confirm — pick 'own' or 'mednex' delivery mode |
| PUT | /api/owner/orders/:id/reject | ✅ owner | Reject with a reason |
| GET/POST | /api/owner/delivery-staff | ✅ owner | Manage this store's own delivery riders |
| PUT | /api/delivery/availability | ✅ delivery | Go online/offline (requires admin approval to go online) |
| GET | /api/delivery/assignments/broadcasting | ✅ delivery | Unclaimed 'mednex' mode deliveries (platform riders only) |
| PUT | /api/delivery/assignments/:id/claim | ✅ delivery | Claim a broadcast — first request wins, atomically |
| GET | /api/delivery/assignments | ✅ delivery | Deliveries assigned to this rider, platform-wide |
| PUT | /api/delivery/assignments/:id/verify-pickup | ✅ delivery | Enter the store's pickup code |
| PUT | /api/delivery/assignments/:id/deliver | ✅ delivery | Enter the customer's OTP; completes delivery + settlement |
| GET/PUT | /api/admin/settings | ✅ admin | Commission %, delivery fee tiers, rider payout rules |
| GET | /api/admin/delivery-boys | ✅ admin | List/verify delivery riders |
| GET | /api/admin/settlements | ✅ admin | Per-order store payable breakdown |
| POST | /api/admin/payouts | ✅ admin | Batch-pay a rider for their unpaid completed deliveries |
| GET | /api/admin/stats | ✅ admin | Platform-wide numbers |

## Online Payments (Razorpay, test mode — free)

1. Sign up free at https://dashboard.razorpay.com (no business verification needed for Test Mode)
2. Turn on the **Test Mode** toggle (top right of the dashboard)
3. Go to Settings → API Keys → Generate Test Key
4. Copy the Key Id and Key Secret into `.env`
5. Restart the server (`npm run dev`)

Until these are filled in, online payment attempts will return a clear "not
configured yet" message and customers can still use Cash on Delivery.

## Customer authentication — no OTP anywhere

Customers sign up and log in with just a mobile number + a password they
create themselves (`POST /api/auth/register` / `POST /api/auth/login`) — no
SMS/email verification step at all. Forgot-password
(`POST /api/auth/password/reset-direct`) is equally direct: enter the mobile
number, set a new password, done — also no verification.

**This is a deliberate product tradeoff, not an oversight.** Skipping
verification means anyone who knows a customer's mobile number can reset
that account's password and log in as them. There's no way to fully close
that gap without reintroducing some form of verification later (OTP,
security question, etc.) if that risk ever becomes a real problem.

The delivery-completion OTP (customer confirms their parcel arrived) is a
completely separate mechanism and is unaffected — see `Order.deliveryOtp`
and `PUT /api/delivery/assignments/:id/deliver`.
