# Tiffin Backend

A real Node.js + Express + PostgreSQL (via Prisma) backend for the Tiffin
Food + Grocery delivery app. It implements every `Services.*` mock
already built into `tiffin-app.html` — swapping the frontend over to this
backend means replacing the body of each `Services.X.method()` mock with
a `fetch()` call to the matching endpoint below. No screen code changes.

## 1. Get a Postgres database (2 minutes, free)

Pick one:
- **Neon** — neon.tech → New Project → copy the connection string
- **Supabase** — supabase.com → New Project → Settings → Database → copy the connection string
- **Railway** — railway.app → New Project → Add Postgres → copy the connection string
- Or run Postgres locally / in Docker if you already have it

## 2. Set up the project

```bash
cd backend
cp .env.example .env
# open .env and paste your DATABASE_URL, set a random JWT_SECRET
npm install
npm run prisma:migrate     # creates all the tables
npm run seed                # loads the same mock vendors/products/coupons/
                             # delivery slabs already in tiffin-app.html —
                             # same ids, so the frontend needs zero remapping
npm run dev                  # starts the API on http://localhost:4000
```

Visit `http://localhost:4000/health` — you should see `{"ok":true}`.

## 2b. Optional: browse the database

```bash
npm run prisma:studio
```

## 3. Dev mode vs. production mode

Two things are intentionally mocked until you configure them, and both
say so loudly rather than pretending to be real:

- **OTP/SMS** (`src/services/otpService.js`): with `OTP_PROVIDER` unset in
  `.env`, `POST /auth/otp/request` returns the generated code directly in
  the response (`devCode`) instead of sending a real SMS — exactly like
  the frontend's own "Demo mode" banner. Set `OTP_PROVIDER` and fill in a
  real provider call (Twilio, MSG91, Gupshup, etc.) to go live.
- **Payments** (`src/services/paymentGatewayService.js`): with
  `PAYMENT_GATEWAY_KEY` unset, charges are simulated locally (~88% success,
  matching the frontend's mock) so the failure/retry flow stays testable
  without a real gateway account. Set the gateway keys and fill in the
  real gateway call + webhook signature verification to go live — see the
  comments in that file and in `src/routes/payments.js`.

## 4. Mapping: frontend `Services.*` → backend endpoint

| Frontend mock (tiffin-app.html) | Backend endpoint |
|---|---|
| `Services.Auth.requestOtp(phone)` | `POST /auth/otp/request` |
| `Services.Auth.verifyOtp(phone, code)` | `POST /auth/otp/verify` (returns a real JWT — store this as the session, not the phone/name) |
| `Services.Auth.logout()` | `POST /auth/logout` |
| — (boot-time session check) | `GET /auth/me` |
| Address CRUD (Stage 2 screens) | `GET/POST/PUT/DELETE /addresses`, `POST /addresses/:id/set-default` |
| `Services.Catalog.getCategories/getProducts` | `GET /catalog/vendors?mode=`, `GET /catalog/vendors/:id/products` |
| Search screen | `GET /catalog/search?mode=&q=&sort=` |
| Vendor reviews | `GET /catalog/vendors/:id/reviews` |
| `Services.DeliveryPricing.quote(distanceKm)` | `POST /delivery-pricing/quote` |
| `Services.Coupons.validate(code, mode, subtotal)` | `POST /coupons/validate` |
| `Services.Orders.create(draft)` | `POST /orders` — **this is where all pricing gets recomputed server-side; see the big comment block at the top of `src/routes/orders.js`** |
| Order History / Order Detail screens | `GET /orders`, `GET /orders/:id` |
| Reorder | Client still re-adds items, but `POST /orders` re-validates stock/price server-side anyway |
| Cancel order (Stage 8) | `POST /orders/:id/cancel` — rules-based charge, never a blanket percentage; see `src/lib/orderLifecycle.js` |
| Rate/review a completed order (Stage 9) | `POST /orders/:id/review` |
| `Services.Payment.charge(amount, method)` | `POST /payments/:orderId/charge` (dev mode resolves immediately; production mode waits for the webhook) |
| Payment gateway confirmation | `POST /payments/webhook` — **never called by the frontend**; only your real gateway calls this |
| `Services.Tracking.subscribe(orderId, onUpdate)` | `GET /tracking/:orderId/stream` (Server-Sent Events), or simpler: poll `GET /orders/:orderId` |
| Favorites (Stage 3) | `GET/POST/DELETE /favorites` |
| Help & Support (Stage 8) | `POST /support/tickets`, `GET /support/tickets`, `GET /support/tickets/:id` |
| In-app notifications (Stage 9) | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| Flash offers (Stage 9) | `GET /flash-offers?vendorId=` (public); `POST /admin/flash-offers` (ops-created, auto-notifies past customers of that vendor) |
| Promotional notification opt-out (Stage 9, brief §25) | `PATCH /auth/me` with `{ promoOptOut: true/false }`; `GET /auth/me` now also returns it |

## 5. The other side of the platform: vendor/rider ops

A customer app has no business advancing its own order's status, marking
its own payment "paid", or deciding its own refund outcome — a real
platform needs the *other* side: whatever the restaurant/store staff and
riders use, and whatever an ops/support team uses. That side exists,
gated by real accounts with scoped roles (Stage 10 — see §6 below for how
this replaced the earlier shared-secret stand-in):

| Action | Endpoint | Who can call it |
|---|---|---|
| Vendor-staff login | `POST /staff/auth/vendor-login` `{ phone, password }` → JWT | anyone with a provisioned account |
| Rider login | `POST /staff/auth/rider-login` `{ phone, password }` → JWT | anyone with a provisioned account |
| List orders for a restaurant/store (their "tablet" view) | `GET /admin/orders?status=active\|past` | vendor staff (own vendor only), superadmin |
| List a rider's own assigned deliveries | `GET /admin/orders` | rider (own deliveries only) |
| Accept an order / mark preparing / ready / assign rider / mark delivered | `POST /admin/orders/:id/advance` | vendor staff (own vendor), the assigned rider once one exists, superadmin |
| Mark a product in/low/out of stock | `POST /admin/products/:id/stock` | vendor staff (own vendor), superadmin |
| Open/close a restaurant or store | `POST /admin/vendors/:id/open-status` | vendor staff (own vendor), superadmin |
| Create a 10-minute flash offer | `POST /admin/flash-offers` | vendor staff (own vendor), superadmin |
| Move a refund through requested → under_review → approved/rejected → processing → completed | `POST /admin/refunds/:id/status` | vendor staff (owning vendor), superadmin |
| Resolve a support ticket | `POST /admin/support-tickets/:id/status` | vendor staff (owning vendor), superadmin |
| Change your own password | `POST /admin/change-password` | vendor staff, rider |

Every `/admin/*` request (except the login/provisioning routes) needs an
`Authorization: Bearer <token>` header from one of the logins above — see
`src/middleware/requireStaff.js`. A vendor-staff token is scoped: it can
only ever touch its own vendor's orders/products/flash-offers/refunds/
tickets, enforced server-side in `routes/admin.js`, not just hidden in a
UI. A rider token can only advance the specific order it's assigned to
once `RIDER ASSIGNED` has happened.

**Provisioning accounts** (creating a restaurant's first login, onboarding
a rider) still needs one shared secret — `ADMIN_API_KEY` — but its job
has shrunk to just this:

```bash
# 1. Trade the admin key for a short-lived superadmin token (hours, not forever)
curl -X POST http://localhost:4000/staff/auth/superadmin -H 'Content-Type: application/json' -d '{"adminKey":"<ADMIN_API_KEY>"}'

# 2. Use that token to create a vendor-staff login
curl -X POST http://localhost:4000/admin/vendor-staff -H 'Authorization: Bearer <superadmin token>' -H 'Content-Type: application/json' \
  -d '{"vendorId":"v_hk","phone":"9000000001","name":"Home Kitchen Staff","password":"a-real-password"}'

# 3. Or a rider login
curl -X POST http://localhost:4000/admin/riders -H 'Authorization: Bearer <superadmin token>' -H 'Content-Type: application/json' \
  -d '{"phone":"9000000101","name":"Ravi Kumar","password":"a-real-password","vehicle":"Bike","plate":"DL 5S 4432"}'
```

`npm run seed` already creates two demo vendor-staff logins and two demo
rider logins for local testing — see the console output when you run it,
or `prisma/seed.js`.

## 6. What changed in Stage 10 (security + testing + production cleanup)

- **Vendor/rider accounts replaced the shared `ADMIN_API_KEY`** for every
  day-to-day ops action — see §5. `ADMIN_API_KEY` now only provisions
  accounts and mints a break-glass superadmin token; it's never sent on
  a routine request anymore.
- **Real push notifications** — set `PUSH_PROVIDER=fcm` (recommended,
  covers Android/iOS/web) or `PUSH_PROVIDER=apns` (iOS only) and fill in
  the matching credentials in `.env`; see `src/lib/push/fcm.js`,
  `src/lib/push/apns.js`, and the device-token endpoints
  (`POST`/`DELETE /notifications/device-token`). The frontend's
  `Services.Push.registerDeviceToken()` extension point (in
  `tiffin-app.html`) is what a real push SDK integration would call —
  see the comment above it for the remaining browser-side steps (Firebase
  JS SDK, a hosted service-worker file, VAPID key), which can't live
  inside one static HTML file.
- **Real OTP SMS delivery** — set `OTP_PROVIDER=twilio` or `msg91` and
  fill in the matching credentials; see `src/services/otpService.js` and
  `src/lib/sms/twilio.js` / `msg91.js`.
- **Not done in this pass, and can't be done from this environment:** an
  actual deploy to a live server/database, and running every §37 flow
  against it. This backend has been syntax-checked and code-reviewed, but
  never executed against a real Postgres instance or a live process — see
  `DEPLOYMENT.md` for the deploy steps and `scripts/smoke-test.js` for a
  script that exercises the §37 flows once you have a deployed URL to
  point it at.
- Rate limiting now also covers `/staff/auth/*` (login attempts), not
  just `/auth/otp/request`.

## 7. What's still deliberately NOT built

- Automated flash-offer expiry cleanup (they simply stop being returned
  by `GET /flash-offers` once expired — nothing deletes old rows)
- Server-side token-blocklist for instant session revocation (both
  customer and staff JWTs are stateless — `POST /auth/logout` and a
  future "log out everywhere" are symmetry/audit endpoints, not real
  server-side revocation, unless you add one)
- Rate limiting is a sane global default plus tight limits on OTP
  requests and staff logins; it is not load-tested or tuned for real
  traffic patterns
- A fuller internal ops dashboard for provisioning accounts — `POST
  /admin/vendor-staff` / `/admin/riders` are the minimum API needed;
  there's no UI for it

## 8. Security notes carried over from the brief

- Every price, discount, delivery fee, and COD eligibility check happens
  **server-side** in `POST /orders` — the client only ever sends product
  ids, quantities, and a coupon code, never amounts.
- Sessions are JWTs carrying only a customer id — no PII, no price data,
  nothing an attacker could usefully tamper with.
- `POST /payments/webhook` is the only route allowed to mark a payment
  "paid"; `POST /payments/:orderId/charge` only *starts* a charge in
  production mode.
- Multi-vendor carts are rejected server-side too (`POST /orders`
  checks every item's `vendorId` against the order's vendor), not just
  guarded in the frontend UI.
- Customer sessions and staff/rider/superadmin sessions are signed with
  **different secrets** (`JWT_SECRET` vs `STAFF_JWT_SECRET`) — a leaked
  customer secret can never forge an ops session, or vice versa.
- Passwords (vendor staff, riders) are hashed with bcrypt (cost 12),
  never stored or logged in plaintext.
