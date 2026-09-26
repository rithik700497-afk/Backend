const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireStaff } = require('../middleware/requireStaff');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');

const router = express.Router();

/**
 * This is the "restaurant tablet" / "store dashboard" / "rider app" side
 * of the platform — the thing that actually moves an order through its
 * lifecycle, since a customer app has no business advancing its own
 * order's status.
 *
 * Stage 10 (brief §37 security pass): this used to be gated by a single
 * shared ADMIN_API_KEY, checked by a now-deleted middleware/requireAdmin.js.
 * It's now gated by real vendor-staff / rider / superadmin
 * accounts (see routes/staffAuth.js for login, middleware/requireStaff.js
 * for the token check). A vendor-staff account is additionally scoped to
 * ONLY its own vendor's orders/products/flash-offers via
 * `assertOwnsVendor` below — this wasn't possible under the old shared-key
 * model, where any key holder could touch any vendor.
 */

function assertOwnsVendor(req, vendorId){
  if(req.staff.role === 'vendor' && req.staff.vendorId !== vendorId){
    throw new ApiError(403, "Not permitted for another vendor's resource");
  }
}

// ---------------------------------------------------------------------
// Provisioning (superadmin only) — creating/deactivating the vendor-staff
// and rider accounts that everything below is gated by. A real platform
// would have a fuller internal ops dashboard for this; these endpoints
// are the minimum needed so onboarding a new restaurant/store/rider
// doesn't require a database console.
// ---------------------------------------------------------------------

const createVendorStaffSchema = z.object({
  vendorId: z.string(),
  phone: z.string().regex(/^[0-9]{10}$/),
  name: z.string().min(1).max(80),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['staff', 'owner']).default('staff')
});
router.post('/vendor-staff', requireStaff(['superadmin']), asyncHandler(async (req, res) => {
  const body = createVendorStaffSchema.parse(req.body);
  const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
  if(!vendor) throw new ApiError(404, 'Vendor not found');
  const passwordHash = await bcrypt.hash(body.password, 12);
  const staff = await prisma.vendorStaff.create({
    data: { vendorId: body.vendorId, phone: body.phone, name: body.name, passwordHash, role: body.role }
  }).catch((e) => { if(e.code === 'P2002') throw new ApiError(409, 'A staff account with this phone already exists'); throw e; });
  res.status(201).json({ id: staff.id, vendorId: staff.vendorId, phone: staff.phone, name: staff.name, role: staff.role });
}));

router.post('/vendor-staff/:id/deactivate', requireStaff(['superadmin']), asyncHandler(async (req, res) => {
  const staff = await prisma.vendorStaff.update({ where: { id: req.params.id }, data: { isActive: false } }).catch(() => null);
  if(!staff) throw new ApiError(404, 'Staff account not found');
  res.json({ ok: true });
}));

const createRiderSchema = z.object({
  phone: z.string().regex(/^[0-9]{10}$/),
  name: z.string().min(1).max(80),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  vehicle: z.string().optional(),
  plate: z.string().optional()
});
router.post('/riders', requireStaff(['superadmin']), asyncHandler(async (req, res) => {
  const body = createRiderSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);
  const rider = await prisma.rider.create({
    data: { phone: body.phone, name: body.name, passwordHash, vehicle: body.vehicle, plate: body.plate }
  }).catch((e) => { if(e.code === 'P2002') throw new ApiError(409, 'A rider account with this phone already exists'); throw e; });
  res.status(201).json({ id: rider.id, phone: rider.phone, name: rider.name, vehicle: rider.vehicle, plate: rider.plate });
}));

router.post('/riders/:id/deactivate', requireStaff(['superadmin']), asyncHandler(async (req, res) => {
  const rider = await prisma.rider.update({ where: { id: req.params.id }, data: { isActive: false } }).catch(() => null);
  if(!rider) throw new ApiError(404, 'Rider not found');
  res.json({ ok: true });
}));

// POST /admin/change-password — any logged-in vendor-staff or rider
// changing their own password (superadmin has no password to change,
// since it isn't a stored account).
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
router.post('/change-password', requireStaff(['vendor', 'rider']), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const model = req.staff.role === 'vendor' ? prisma.vendorStaff : prisma.rider;
  const account = await model.findUnique({ where: { id: req.staff.id } });
  if(!account || !(await bcrypt.compare(currentPassword, account.passwordHash))){
    throw new ApiError(401, 'Current password is incorrect');
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await model.update({ where: { id: req.staff.id }, data: { passwordHash } });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Vendor-side operations (vendor staff for their own vendor, or superadmin)
// ---------------------------------------------------------------------

// GET /admin/orders?vendorId=&status=active|past
// A vendor-staff account may only ever query its own vendorId — if it's
// omitted, it's defaulted to req.staff.vendorId rather than left open.
router.get('/orders', requireStaff(['vendor', 'rider', 'superadmin']), asyncHandler(async (req, res) => {
  const where = {};
  if(req.staff.role === 'vendor'){
    where.vendorId = req.staff.vendorId;
  } else if(req.staff.role === 'rider'){
    where.riderId = req.staff.id; // riders only ever see their own assigned deliveries
  } else if(req.query.vendorId){
    where.vendorId = req.query.vendorId;
  }
  const orders = await prisma.order.findMany({
    where, include: { items: true, vendor: true, customer: true, address: true, rider: true },
    orderBy: { placedAt: 'desc' }, take: 200
  });
  const filtered = req.query.status === 'active'
    ? orders.filter(o => !o.cancelled && !['DELIVERED','PICKED UP BY YOU'].includes(o.status))
    : req.query.status === 'past'
    ? orders.filter(o => o.cancelled || ['DELIVERED','PICKED UP BY YOU'].includes(o.status))
    : orders;
  res.json(filtered);
}));

// POST /admin/orders/:id/advance — restaurant/store accepting, prepping,
// marking ready; a rider picking up and completing delivery. Once an
// order reaches RIDER ASSIGNED, only the assigned rider (or the owning
// vendor / superadmin, for exceptions) may advance it further — a rider
// can no longer advance someone else's delivery, which the old shared-key
// model had no way to prevent.
router.post('/orders/:id/advance', requireStaff(['vendor', 'rider', 'superadmin']), asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if(!order) throw new ApiError(404, 'Order not found');
  assertOwnsVendor(req, order.vendorId);

  const riderIdx = order.statusChain.indexOf('RIDER ASSIGNED');
  const pastRiderAssignment = riderIdx !== -1 && order.statusIndex >= riderIdx;
  if(req.staff.role === 'rider' && pastRiderAssignment && order.riderId && order.riderId !== req.staff.id){
    throw new ApiError(403, 'This delivery is assigned to a different rider');
  }

  if(order.cancelled || order.statusIndex >= order.statusChain.length - 1){
    return res.json(order);
  }
  const nextIndex = order.statusIndex + 1;
  const nextStatus = order.statusChain[nextIndex];
  const data = { statusIndex: nextIndex, status: nextStatus };

  if(riderIdx !== -1 && nextIndex === riderIdx && !order.riderId){
    // Assign a real, active rider account rather than the old
    // RIDER_POOL mock — picks at random among currently-active riders,
    // same as the mock's spirit, but now a real account that can then
    // authenticate and advance only this delivery.
    const activeRiders = await prisma.rider.findMany({ where: { isActive: true } });
    if(activeRiders.length){
      const rider = activeRiders[Math.floor(Math.random() * activeRiders.length)];
      Object.assign(data, { riderId: rider.id, riderName: rider.name, riderPhone: rider.phone, riderVehicle: rider.vehicle, riderPlate: rider.plate });
    }
  }

  const updated = await prisma.order.update({ where: { id: order.id }, data });

  const STATUS_LABEL = {
    'RESTAURANT ACCEPTED':'Your order was accepted', 'STORE ACCEPTED':'Your order was accepted',
    'PREPARING':'Your order is being prepared', 'PACKING':'Your order is being packed',
    'READY':'Your order is ready', 'READY FOR PICKUP':'Your order is ready for pickup',
    'RIDER ASSIGNED':'A rider has been assigned', 'PICKED UP':'Your order has been picked up',
    'OUT FOR DELIVERY':'Your order is out for delivery', 'DELIVERED':'Your order has been delivered',
    'PICKED UP BY YOU':'Order marked as picked up'
  };
  await notificationService.notify({
    customerId: order.customerId, type:'order_status',
    title: STATUS_LABEL[nextStatus] || nextStatus, body: `Order #${order.id.slice(-6)} — ${nextStatus}`,
    orderId: order.id
  });

  res.json(updated);
}));

// POST /admin/products/:id/stock  { stock: 'in'|'low'|'out' }
router.post('/products/:id/stock', requireStaff(['vendor', 'superadmin']), asyncHandler(async (req, res) => {
  const { stock } = z.object({ stock: z.enum(['in','low','out']) }).parse(req.body);
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if(!existing) throw new ApiError(404, 'Product not found');
  assertOwnsVendor(req, existing.vendorId);
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { stock } });
  res.json(product);
}));

// POST /admin/vendors/:id/open-status  { isOpen: boolean }
router.post('/vendors/:id/open-status', requireStaff(['vendor', 'superadmin']), asyncHandler(async (req, res) => {
  const { isOpen } = z.object({ isOpen: z.boolean() }).parse(req.body);
  assertOwnsVendor(req, req.params.id);
  const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: { isOpen } }).catch(() => null);
  if(!vendor) throw new ApiError(404, 'Vendor not found');
  res.json(vendor);
}));

// ---- Flash offers (brief §19) ----
const flashOfferSchema = z.object({
  vendorId: z.string(),
  itemName: z.string().min(1),
  originalPrice: z.number().positive(),
  offerPrice: z.number().positive(),
  quantity: z.number().int().positive(),
  durationMinutes: z.number().int().positive().default(10) // brief's own example is a 10-minute flash offer
});
router.post('/flash-offers', requireStaff(['vendor', 'superadmin']), asyncHandler(async (req, res) => {
  const body = flashOfferSchema.parse(req.body);
  assertOwnsVendor(req, body.vendorId);
  if(body.offerPrice >= body.originalPrice) throw new ApiError(400, 'offerPrice must be less than originalPrice');
  const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
  if(!vendor) throw new ApiError(404, 'Vendor not found');

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + body.durationMinutes * 60 * 1000);
  const offer = await prisma.flashOffer.create({
    data: { vendorId: body.vendorId, itemName: body.itemName, originalPrice: body.originalPrice, offerPrice: body.offerPrice, quantity: body.quantity, startsAt, expiresAt }
  });

  // brief §19: "Push notification should be targeted appropriately rather
  // than automatically spamming every customer." Rather than notifying
  // every customer in the database, target the ones who have actually
  // ordered from THIS vendor before — a real deployment would refine this
  // further with a service-area/geo check, but "past customers of this
  // vendor" is a meaningfully targeted set, not everyone. notify() itself
  // still honors each customer's promoOptOut, since this is a promo push.
  const pastCustomers = await prisma.order.findMany({
    where: { vendorId: body.vendorId },
    select: { customerId: true },
    distinct: ['customerId']
  });
  await Promise.all(pastCustomers.map(({ customerId }) => notificationService.notify({
    customerId, type: 'flash_offer',
    title: `🔥 10-minute flash offer at ${vendor.name}`,
    body: `${body.itemName} — ₹${body.offerPrice} (was ₹${body.originalPrice}). Ends in ${body.durationMinutes} min.`,
    orderId: null
  })));

  res.status(201).json(offer);
}));

// ---- Refunds (brief §17) — admin moves a refund through its states ----
router.post('/refunds/:id/status', requireStaff(['vendor', 'superadmin']), asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['under_review','approved','rejected','processing','completed']) }).parse(req.body);
  const existing = await prisma.refund.findUnique({ where: { id: req.params.id } });
  if(!existing) throw new ApiError(404, 'Refund not found');
  const relatedOrder = await prisma.order.findUnique({ where: { id: existing.orderId } });
  if(relatedOrder) assertOwnsVendor(req, relatedOrder.vendorId);

  const refund = await prisma.refund.update({ where: { id: req.params.id }, data: { status } });
  if(relatedOrder){
    await notificationService.notify({
      customerId: relatedOrder.customerId, type:'refund',
      title: `Refund ${status.replace('_',' ')}`,
      body: `Your refund of ₹${refund.amount.toFixed(2)} for order #${relatedOrder.id.slice(-6)} is now ${status.replace('_',' ')}.`,
      orderId: relatedOrder.id
    });
  }
  res.json(refund);
}));

// ---- Support tickets (brief §24) — admin updates status ----
router.post('/support-tickets/:id/status', requireStaff(['vendor', 'superadmin']), asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['open','in_progress','resolved','closed']) }).parse(req.body);
  const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if(!existing) throw new ApiError(404, 'Ticket not found');
  if(existing.orderId){
    const relatedOrder = await prisma.order.findUnique({ where: { id: existing.orderId } });
    if(relatedOrder) assertOwnsVendor(req, relatedOrder.vendorId);
  } else if(req.staff.role === 'vendor'){
    // A ticket with no linked order can't be scoped to a vendor — only
    // superadmin handles those (e.g. general account/app-level tickets).
    throw new ApiError(403, 'Not permitted for this ticket');
  }
  const ticket = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status } });
  res.json(ticket);
}));

module.exports = router;
