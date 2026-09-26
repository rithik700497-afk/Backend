# Deploying `tiffin-backend` and running the §37 flows live

This is the Stage 10 piece that genuinely can't be done from inside this
chat: an actual deploy needs a live Postgres instance, a live process
listening on the internet, and (for the parts of this doc marked 🔑) real
third-party credentials (Twilio/MSG91, Firebase). None of that exists
inside this environment's sandbox, which also has no outbound network
access — so what follows is the exact steps to run yourself, plus a
script (`scripts/smoke-test.js`) that automates re-running every §37 flow
against your deployed URL once it's up, so you don't have to click
through the app by hand to check each one.

**Fastest path:** this folder now ships `render.yaml` — push it to GitHub,
then Render dashboard → New → Blueprint → connect the repo, and Render
provisions the web service *and* a free Postgres DB together, wiring
`DATABASE_URL` and generating `JWT_SECRET`/`STAFF_JWT_SECRET` for you
automatically. You only need to fill in `CORS_ORIGINS` and
`ADMIN_API_KEY` by hand afterward. Steps 1–2 below are the manual
equivalent if you'd rather not use the Blueprint (or are on Railway,
which reads `railway.json` the same way).

## 1. Get a Postgres database

Same as local dev (README.md §1) — Neon, Supabase, or Railway's own
Postgres add-on all work and are free to start. Copy the connection
string; you'll need it as `DATABASE_URL`.

## 2. Deploy the API

Any Node host works; two free/cheap ones that need no Dockerfile:

### Option A — Render
1. Push this `backend/` folder to its own git repo (or a subfolder of
   one — Render lets you set a root directory).
2. Render dashboard → New → Web Service → connect the repo.
3. Root directory: `backend` (if it's a subfolder). Build command:
   `npm install && npm run prisma:generate`. Start command: `npm start`.
4. Add every env var from `.env.example` under Environment — see §4
   below for what to actually put in each one.
5. Deploy. Render gives you a URL like `https://tiffin-backend.onrender.com`.

### Option B — Railway
1. `railway init` in the `backend/` folder (or connect the repo in the
   dashboard).
2. Add a Postgres plugin (or paste an external `DATABASE_URL`).
3. Set the same env vars as above under Variables.
4. Railway auto-detects `npm start`. Deploy. Copy the generated domain.

## 3. Run migrations + seed against the live database

From your own machine (with `DATABASE_URL` in your local `.env` pointed
at the SAME live database, not localhost):

```bash
cd backend
npm run prisma:migrate   # first deploy only: creates every table + the migration files
npm run seed              # vendors/products/coupons + demo vendor-staff/rider logins
```

On every later deploy (once migration files already exist and are
committed), use `npm run prisma:migrate:deploy` instead — it applies
existing migrations without prompting or trying to create new ones,
which is what a non-interactive production environment needs.

## 4. Environment variables — what to actually set

| Var | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | always | from step 1 |
| `JWT_SECRET`, `STAFF_JWT_SECRET` | always | two DIFFERENT long random strings — `openssl rand -hex 32` twice |
| `PORT` | usually not | most hosts set this themselves |
| `CORS_ORIGINS` | always | your deployed frontend's exact origin, comma-separated if more than one |
| `ADMIN_API_KEY` | always | one more long random string — keep it in a secrets manager, not committed anywhere |
| `OTP_PROVIDER` + Twilio/MSG91 vars 🔑 | for real SMS | leave unset to keep OTP in dev mode (safe to leave unset for an initial live test) |
| `PUSH_PROVIDER` + FCM/APNs vars 🔑 | for real push | leave unset to keep push in dev mode (in-app feed still works) |
| `PAYMENT_GATEWAY_KEY`/`SECRET` 🔑 | for real payments | leave unset to keep the ~88%-success simulated gateway |

**Recommended first live deploy: leave every 🔑 row unset.** That gets
you a genuinely deployed, genuinely running server and database — the
actual gap this stage is about — without also needing three external
accounts before you can test anything. Add real SMS/push/payments after
confirming the base deploy works.

## 5. Point the frontend(s) at it

In `tiffin-app.html` (customer app) and `tiffin-merchant-app.html`
(merchant + rider app), set:

```js
const API_BASE_URL = 'https://your-deployed-url.onrender.com';
```

(No trailing slash.) Everything else in both apps already branches on
this being set — see README.md §4's mapping table.

**Important if you're using the merchant app's published claude.ai
artifact link:** a published artifact page can only load scripts/fonts
from a fixed allow-list of hosts, and that same sandbox blocks `fetch()`
calls to any other domain — including your own backend. So the
published link will silently fail to reach a live API no matter what
you set `API_BASE_URL` to. To actually go live, download the
`tiffin-merchant-app.html` file (with `API_BASE_URL` set) and host it
yourself — a static host like Netlify/Vercel/Render Static Site, or
anywhere else you control — rather than relying on the claude.ai
artifact link for the real deployment.

## 6. Run the §37 flows against the live deploy

```bash
cd backend
node scripts/smoke-test.js https://your-deployed-url.onrender.com
```

This exercises, against the real deployed API: health check, OTP
request+verify (dev mode) and new-customer creation, address CRUD,
catalog browsing + search, coupon validation, delivery-pricing quote, a
full order placement (delivery, food), payment charge (dev-mode
simulated gateway, retried until it lands since it's ~88% success),
order tracking, order cancellation on a second order, favorites, a
support ticket, notifications (list/read), flash offers (public list),
the full superadmin → vendor-staff-provisioning → vendor-login →
order-advance chain, and rider provisioning + login + delivery handoff.
It prints a pass/fail line per flow and exits non-zero if anything
failed, so you can wire it into CI once you have a staging URL that's
always up.

**What it does NOT cover:** anything gated behind a 🔑 credential you
left unset (real SMS, real push, real payment webhooks) — those need
manual testing once you've configured a real provider, since the script
has no way to receive an actual SMS or push notification to confirm
delivery. For those three specifically:
- **Real OTP**: request one via the app/API with `OTP_PROVIDER` set, confirm the SMS arrives on a real phone within a few seconds, and that the code actually works in `/auth/otp/verify`.
- **Real push**: register a real device token (see `tiffin-app.html`'s `Services.Push` comment for what that requires), trigger a notification (e.g. advance an order's status), confirm it arrives on the device.
- **Real payments**: use your gateway's sandbox/test-mode card numbers, confirm the webhook (`POST /payments/webhook`) actually gets called by the real gateway and moves the order to `paid`.
