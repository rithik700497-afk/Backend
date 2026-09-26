#!/usr/bin/env node
/**
 * Stage 10 (brief §37) — runs the app's real end-to-end flows against a
 * DEPLOYED tiffin-backend, using nothing but the built-in fetch (Node 18+).
 *
 * Usage:
 *   node scripts/smoke-test.js https://your-deployed-url.onrender.com
 *   node scripts/smoke-test.js http://localhost:4000   # also fine against local dev
 *
 * Requires the target server to be running in OTP dev mode (OTP_PROVIDER
 * unset) so /auth/otp/request returns devCode directly — see DEPLOYMENT.md
 * for why that's the recommended setting for this first live test.
 * Also requires ADMIN_API_KEY to be set on the server AND passed here via
 * the ADMIN_API_KEY env var, since provisioning a vendor-staff/rider login
 * needs it.
 *
 * Exits 0 if every flow passed, 1 if any failed — safe to wire into CI
 * against a staging URL.
 */

const BASE = process.argv[2];
if(!BASE){
  console.error('Usage: node scripts/smoke-test.js <base-url>');
  process.exit(1);
}
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

let passed = 0, failed = 0;
const results = [];

async function step(name, fn){
  try {
    await fn();
    results.push({ name, ok: true });
    passed++;
    console.log(`✓ ${name}`);
  } catch(e){
    results.push({ name, ok: false, error: e.message });
    failed++;
    console.log(`✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg){ if(!cond) throw new Error(msg || 'assertion failed'); }

async function req(path, opts = {}){
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await fetch(BASE + path, Object.assign({}, opts, {
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  }));
  let data = null;
  try { data = await res.json(); } catch(e){ /* empty body ok */ }
  return { status: res.status, ok: res.ok, data };
}

// Unique per run so re-running the script doesn't collide with prior
// runs' phone numbers / addresses.
const runId = Date.now().toString().slice(-8);
const customerPhone = `70000${runId.slice(-5)}`;

let customerToken, customerId, addressId, deliveryOrderId, pickupOrderId;
let superadminToken, vendorStaffId, vendorToken, riderId, riderToken;

async function main(){
  console.log(`\nRunning §37 smoke test against ${BASE}\n`);

  await step('GET /health', async () => {
    const r = await req('/health');
    assert(r.ok && r.data.ok === true, `expected {ok:true}, got ${JSON.stringify(r.data)}`);
  });

  await step('OTP request (dev mode) returns devCode', async () => {
    const r = await req('/auth/otp/request', { method: 'POST', body: { phone: customerPhone } });
    assert(r.ok, JSON.stringify(r.data));
    assert(r.data.devCode, 'no devCode in response — is OTP_PROVIDER set on the server? Dev mode is required for this script.');
    main._otpCode = r.data.devCode;
  });

  await step('OTP verify creates a new customer (name required)', async () => {
    const r = await req('/auth/otp/verify', { method: 'POST', body: { phone: customerPhone, code: main._otpCode } });
    assert(r.ok && r.data.isNewCustomer === true, JSON.stringify(r.data));
    assert(!r.data.token, 'expected no token yet — new customer must submit a name first');
  });

  await step('OTP verify + name logs in and returns a session token', async () => {
    const r = await req('/auth/otp/verify', { method: 'POST', body: { phone: customerPhone, code: main._otpCode, name: 'Smoke Test Customer' } });
    assert(r.ok && r.data.token, JSON.stringify(r.data));
    customerToken = r.data.token;
    customerId = r.data.customer.id;
  });

  const authed = (opts = {}) => Object.assign({}, opts, { headers: Object.assign({ Authorization: `Bearer ${customerToken}` }, opts.headers || {}) });

  await step('GET /auth/me reflects the logged-in customer', async () => {
    const r = await req('/auth/me', authed());
    assert(r.ok && r.data.id === customerId, JSON.stringify(r.data));
  });

  await step('PATCH /auth/me updates promoOptOut', async () => {
    const r = await req('/auth/me', authed({ method: 'PATCH', body: { promoOptOut: true } }));
    assert(r.ok && r.data.promoOptOut === true, JSON.stringify(r.data));
    await req('/auth/me', authed({ method: 'PATCH', body: { promoOptOut: false } })); // reset for the rest of the flow (flash-offer notify test relies on this)
  });

  await step('POST /addresses creates the first (default) address', async () => {
    const r = await req('/addresses', authed({ method: 'POST', body: {
      label: 'Home', name: 'Smoke Test', phone: customerPhone,
      address: '123 Test Street', city: 'Testville', pin: '110001'
    }}));
    assert(r.ok && r.data.isDefault === true, JSON.stringify(r.data));
    addressId = r.data.id;
  });

  await step('GET /catalog/vendors?mode=food returns seeded vendors', async () => {
    const r = await req('/catalog/vendors?mode=food');
    assert(r.ok && Array.isArray(r.data) && r.data.length > 0, JSON.stringify(r.data));
  });

  await step('GET /catalog/search finds a known seeded product', async () => {
    const r = await req('/catalog/search?mode=food&q=dal');
    assert(r.ok && r.data.products.some(p => /dal/i.test(p.name)), JSON.stringify(r.data));
  });

  await step('POST /coupons/validate accepts a known seeded coupon', async () => {
    const r = await req('/coupons/validate', authed({ method: 'POST', body: { code: 'TIFFIN20', mode: 'food', subtotal: 200 } }));
    assert(r.ok && r.data.valid === true, JSON.stringify(r.data));
  });

  await step('POST /delivery-pricing/quote returns a fee', async () => {
    const r = await req('/delivery-pricing/quote', { method: 'POST', body: { distanceKm: 1.5 } });
    assert(r.ok && typeof r.data.fee === 'number', JSON.stringify(r.data));
  });

  await step('POST /orders places a delivery order with server-computed pricing', async () => {
    const r = await req('/orders', authed({ method: 'POST', body: {
      vendorId: 'v_hk',
      items: [{ productId: 'p1', qty: 2 }],
      fulfilment: 'delivery',
      addressId,
      paymentMethod: 'upi'
    }}));
    assert(r.ok, JSON.stringify(r.data));
    assert(r.data.total > 0 && r.data.subtotal === 218, `expected subtotal 218 (2x Dal Do Pyaza @109), got ${JSON.stringify(r.data)}`);
    deliveryOrderId = r.data.id;
  });

  await step('POST /orders rejects a mixed-vendor cart', async () => {
    const r = await req('/orders', authed({ method: 'POST', body: {
      vendorId: 'v_hk', items: [{ productId: 'g1', qty: 1 }], fulfilment: 'pickup', paymentMethod: 'cod'
    }}));
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await step('POST /orders places a second (pickup) order for cancellation testing', async () => {
    const r = await req('/orders', authed({ method: 'POST', body: {
      vendorId: 'v_hk', items: [{ productId: 'p2', qty: 1 }], fulfilment: 'pickup', paymentMethod: 'cod'
    }}));
    assert(r.ok, JSON.stringify(r.data));
    pickupOrderId = r.data.id;
  });

  await step('GET /orders lists both orders for this customer', async () => {
    const r = await req('/orders', authed());
    assert(r.ok && r.data.length >= 2, JSON.stringify(r.data));
  });

  await step('POST /payments/:orderId/charge resolves in dev mode', async () => {
    // Dev-mode gateway is ~88% success — retry a few times so the test
    // isn't flaky on an unlucky simulated decline.
    let lastStatus;
    for(let i = 0; i < 8; i++){
      const r = await req(`/payments/${deliveryOrderId}/charge`, authed({ method: 'POST' }));
      assert(r.ok, JSON.stringify(r.data));
      lastStatus = r.data.status;
      if(lastStatus === 'paid') break;
    }
    assert(lastStatus === 'paid', `payment never succeeded after retries (last status: ${lastStatus}) — real gateway mode won't resolve synchronously, that's expected`);
  });

  await step('POST /orders/:id/cancel cancels the pickup (COD) order', async () => {
    const r = await req(`/orders/${pickupOrderId}/cancel`, authed({ method: 'POST', body: { reason: 'Changed my mind' } }));
    assert(r.ok && r.data.order.cancelled === true, JSON.stringify(r.data));
  });

  await step('POST /favorites favorites a vendor', async () => {
    const r = await req('/favorites', authed({ method: 'POST', body: { vendorId: 'v_hk' } }));
    assert(r.ok, JSON.stringify(r.data));
  });

  await step('GET /favorites reflects it', async () => {
    const r = await req('/favorites', authed());
    assert(r.ok && r.data.some(f => f.vendorId === 'v_hk'), JSON.stringify(r.data));
  });

  await step('POST /support/tickets opens a ticket', async () => {
    const r = await req('/support/tickets', authed({ method: 'POST', body: { category: 'Other', message: 'Smoke test ticket', orderId: deliveryOrderId } }));
    assert(r.ok, JSON.stringify(r.data));
    main._ticketId = r.data.id;
  });

  await step('GET /notifications shows the order-placed notification', async () => {
    const r = await req('/notifications', authed());
    assert(r.ok && r.data.some(n => n.orderId === deliveryOrderId), JSON.stringify(r.data));
    main._notificationId = r.data.find(n => n.orderId === deliveryOrderId).id;
  });

  await step('POST /notifications/:id/read marks it read', async () => {
    const r = await req(`/notifications/${main._notificationId}/read`, authed({ method: 'POST' }));
    assert(r.ok && r.data.readAt, JSON.stringify(r.data));
  });

  await step('GET /flash-offers returns the seeded live offers', async () => {
    const r = await req('/flash-offers');
    assert(r.ok && Array.isArray(r.data), JSON.stringify(r.data));
  });

  // -------------------------------------------------------------------
  // Vendor / rider ops — Stage 10's real account model
  // -------------------------------------------------------------------

  if(!ADMIN_API_KEY){
    console.log('\n(skipping vendor/rider ops flows — set ADMIN_API_KEY env var to run them)\n');
  } else {
    await step('POST /staff/auth/superadmin trades ADMIN_API_KEY for a token', async () => {
      const r = await req('/staff/auth/superadmin', { method: 'POST', body: { adminKey: ADMIN_API_KEY } });
      assert(r.ok && r.data.token, JSON.stringify(r.data));
      superadminToken = r.data.token;
    });

    const asSuperadmin = (opts = {}) => Object.assign({}, opts, { headers: Object.assign({ Authorization: `Bearer ${superadminToken}` }, opts.headers || {}) });

    const vendorPhone = `80000${runId.slice(-5)}`;
    await step('POST /admin/vendor-staff provisions a vendor login', async () => {
      const r = await req('/admin/vendor-staff', asSuperadmin({ method: 'POST', body: {
        vendorId: 'v_hk', phone: vendorPhone, name: 'Smoke Test Staff', password: 'smoketestpassword1'
      }}));
      assert(r.ok, JSON.stringify(r.data));
      vendorStaffId = r.data.id;
    });

    await step('POST /staff/auth/vendor-login authenticates the new vendor account', async () => {
      const r = await req('/staff/auth/vendor-login', { method: 'POST', body: { phone: vendorPhone, password: 'smoketestpassword1' } });
      assert(r.ok && r.data.token, JSON.stringify(r.data));
      vendorToken = r.data.token;
    });

    const asVendor = (opts = {}) => Object.assign({}, opts, { headers: Object.assign({ Authorization: `Bearer ${vendorToken}` }, opts.headers || {}) });

    await step('Vendor staff cannot see another vendor\'s orders', async () => {
      const r = await req('/admin/orders?vendorId=v_pr', asVendor());
      // scoping is enforced server-side regardless of the vendorId query param
      assert(r.ok && r.data.every(o => o.vendorId === 'v_hk'), JSON.stringify(r.data));
    });

    await step('POST /admin/orders/:id/advance accepts the order (vendor)', async () => {
      const r = await req(`/admin/orders/${deliveryOrderId}/advance`, asVendor({ method: 'POST' }));
      assert(r.ok && r.data.status !== 'ORDER PLACED', JSON.stringify(r.data));
    });

    const riderPhone = `90000${runId.slice(-5)}`;
    await step('POST /admin/riders provisions a rider login', async () => {
      const r = await req('/admin/riders', asSuperadmin({ method: 'POST', body: {
        phone: riderPhone, name: 'Smoke Test Rider', password: 'smoketestpassword1', vehicle: 'Bike', plate: 'TS 00 TT 0000'
      }}));
      assert(r.ok, JSON.stringify(r.data));
      riderId = r.data.id;
    });

    await step('POST /staff/auth/rider-login authenticates the new rider account', async () => {
      const r = await req('/staff/auth/rider-login', { method: 'POST', body: { phone: riderPhone, password: 'smoketestpassword1' } });
      assert(r.ok && r.data.token, JSON.stringify(r.data));
      riderToken = r.data.token;
    });

    await step('Advancing the order through to RIDER ASSIGNED works (vendor)', async () => {
      let order;
      for(let i = 0; i < 5; i++){
        const r = await req(`/admin/orders/${deliveryOrderId}/advance`, asVendor({ method: 'POST' }));
        assert(r.ok, JSON.stringify(r.data));
        order = r.data;
        if(order.status === 'RIDER ASSIGNED') break;
      }
      assert(order.status === 'RIDER ASSIGNED', `expected RIDER ASSIGNED, got ${order.status}`);
    });

    await step('Assigned rider can see the order and advance it further', async () => {
      const asRider = (opts = {}) => Object.assign({}, opts, { headers: Object.assign({ Authorization: `Bearer ${riderToken}` }, opts.headers || {}) });
      const list = await req('/admin/orders', asRider());
      assert(list.ok && list.data.some(o => o.id === deliveryOrderId), 'rider cannot see their own assigned order');
      const advance = await req(`/admin/orders/${deliveryOrderId}/advance`, asRider({ method: 'POST' }));
      assert(advance.ok && advance.data.status === 'PICKED UP', `expected PICKED UP, got ${JSON.stringify(advance.data)}`);
    });

    await step('Vendor-staff deactivation blocks further logins', async () => {
      const deact = await req(`/admin/vendor-staff/${vendorStaffId}/deactivate`, asSuperadmin({ method: 'POST' }));
      assert(deact.ok, JSON.stringify(deact.data));
      const relogin = await req('/staff/auth/vendor-login', { method: 'POST', body: { phone: vendorPhone, password: 'smoketestpassword1' } });
      assert(relogin.status === 401, `expected 401 after deactivation, got ${relogin.status}`);
    });
  }

  // -------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if(failed > 0) process.exit(1);
}

main().catch(e => { console.error('Smoke test crashed:', e); process.exit(1); });
