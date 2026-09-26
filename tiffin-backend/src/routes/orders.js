const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const deliveryPricingService = require('../services/deliveryPricingService');
const notificationService = require('../services/notificationService');
const { statusChainFor, isTerminalStatus, cancellationPolicyFor } = require('../lib/orderLifecycle');

const router = express.Router();
router.use(requireAuth);

const TAX_RATE = 0.05; // MOCK — a real backend owns actual GST/tax config; kept as one constant to change
const COD_LIMIT = 3000; // MOCK — backend-configurable COD eligibility ceiling (brief §11)

const createOrderSchema = z.object({
  vendorId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    qty: z.number().int().positive(),
    addons: z.array(z.string()).optional().default([]),
    note: z.string().optional().default('')
  })).min(1),
  fulfilment: z.enum(['delivery', 'pickup']).default('delivery'),
  deliveryType: z.enum(['instant', 'scheduled']).nullable().optional(),
  scheduleDate: z.string().nullable().optional(),
  scheduleSlot: z.string().nullable().optional(),
  addressId: z.string().nullable().optional(),
  couponCode: z.string().nullable().optional(),
  paymentMethod: z.enum(['upi', 'card', 'netbanking', 'cod'])
});

// POST /orders — creates an order with SERVER-COMPUTED pricing.
// The client sends product ids/quantities/addon names and a coupon code;
// every price, the discount, the delivery fee, and the tax are all
// recalculated here from the database, never taken from the request body.
// This is deliberate per brief §30: "Never trust client-side: Prices,
// ..., Coupon discount, ... All important values must be validated
// server-side."
router.post('/', asyncHandler(async (req, res) => {
  const body = createOrderSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
  if(!vendor) throw new ApiError(404, 'Vendor not found');
  if(!vendor.isOpen) throw new ApiError(409, `${vendor.name} is currently closed`);

  const productIds = body.items.map(i => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  // Multi-vendor rule (brief §33): every item must belong to the same
  // vendor as the order — reject anything else rather than silently
  // forming an invalid mixed-vendor order.
  const orderItemsData = [];
  let subtotal = 0;
  for(const line of body.items){
    const product = productMap[line.productId];
    if(!product) throw new ApiError(400, `Product ${line.productId} not found`);
    if(product.vendorId !== body.vendorId) throw new ApiError(400, `Product ${product.name} does not belong to vendor ${vendor.name}`);
    if(product.stock === 'out') throw new ApiError(409, `${product.name} is currently out of stock`);

    const availableAddons = Array.isArray(product.addons) ? product.addons : [];
    const chosenAddons = (line.addons || []).map(name => {
      const match = availableAddons.find(a => a.name === name);
      if(!match) throw new ApiError(400, `Add-on "${name}" is not valid for ${product.name}`);
      return match;
    });
    const addonsTotal = chosenAddons.reduce((s,a) => s + a.price, 0);
    const lineTotal = (product.price + addonsTotal) * line.qty;
    subtotal += lineTotal;

    orderItemsData.push({
      productId: product.id,
      name: product.name,
      price: product.price + addonsTotal,
      qty: line.qty,
      addons: chosenAddons,
      note: line.note || ''
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  let discount = 0;
  let couponId = null;
  if(body.couponCode){
    const coupon = await prisma.coupon.findUnique({ where: { code: body.couponCode.toUpperCase() } });
    if(coupon && coupon.isActive && coupon.mode === vendor.mode && subtotal >= coupon.minOrder
       && (!coupon.expiresAt || coupon.expiresAt > new Date())){
      const usesByThisCustomer = await prisma.order.count({ where: { couponId: coupon.id, customerId: req.customer.id, cancelled: false } });
      if(usesByThisCustomer < coupon.perUserLimit){
        const raw = coupon.type === 'percent' ? subtotal * coupon.value / 100 : coupon.value;
        discount = Math.round(Math.min(raw, coupon.maxDiscount) * 100) / 100;
        couponId = coupon.id;
      }
    }
  }

  let deliveryFee = 0;
  let address = null;
  if(body.fulfilment === 'delivery'){
    if(!body.addressId) throw new ApiError(400, 'A delivery address is required');
    address = await prisma.address.findUnique({ where: { id: body.addressId } });
    if(!address || address.customerId !== req.customer.id) throw new ApiError(400, 'Address not found');
    deliveryFee = await deliveryPricingService.quote(vendor.distanceKm);
  }

  const taxable = Math.max(subtotal - discount, 0);
  const tax = Math.round(taxable * TAX_RATE * 100) / 100;
  const total = Math.max(Math.round((taxable + tax + deliveryFee) * 100) / 100, 0);

  if(body.paymentMethod === 'cod' && total > COD_LIMIT){
    throw new ApiError(400, `Cash on Delivery isn't available for orders above ₹${COD_LIMIT}`);
  }

  const statusChain = statusChainFor({ vendorMode: vendor.mode, fulfilment: body.fulfilment, deliveryType: body.deliveryType });

  const order = await prisma.order.create({
    data: {
      customerId: req.customer.id,
      vendorId: vendor.id,
      addressId: address ? address.id : null,
      fulfilment: body.fulfilment,
      deliveryType: body.deliveryType || null,
      scheduleDate: body.scheduleDate || null,
      scheduleSlot: body.scheduleSlot || null,
      subtotal, discount, couponId, deliveryFee, tax, total,
      paymentMethod: body.paymentMethod,
      paymentStatus: body.paymentMethod === 'cod' ? 'pending' : 'processing',
      status: statusChain[0],
      statusChain,
      statusIndex: 0,
      pickupCode: body.fulfilment === 'pickup' ? String(Math.floor(1000 + Math.random()*9000)) : null,
      items: { create: orderItemsData }
    },
    include: { items: true, vendor: true, address: true }
  });

  await notificationService.notify({
    customerId: req.customer.id,
    type: 'order_status',
    title: 'Order placed',
    body: `Your order from ${vendor.name} has been placed.`,
    orderId: order.id
  });

  res.status(201).json(order);
}));

// GET /orders
router.get('/', asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.customer.id },
    include: { items: true, vendor: true, refund: true, review: true },
    orderBy: { placedAt: 'desc' }
  });
  res.json(orders);
}));

// GET /orders/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, vendor: true, address: true, payment: true, refund: true, review: true }
  });
  if(!order || order.customerId !== req.customer.id) throw new ApiError(404, 'Order not found');
  res.json(order);
}));

// POST /orders/:id/cancel — rules-based cancellation (brief §16).
// Charge/refund logic mirrors cancellationPolicyFor() exactly, computed
// server-side so it can't be bypassed by a tampered client request.
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(1).max(200) }).parse(req.body);
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if(!order || order.customerId !== req.customer.id) throw new ApiError(404, 'Order not found');

  const policy = cancellationPolicyFor(order);
  if(!policy.cancellable) throw new ApiError(400, policy.reasonBlocked);

  const charge = Math.round(order.subtotal * policy.chargePct * 100) / 100;
  const refundAmount = Math.max(order.total - charge, 0);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { cancelled: true, cancelReason: reason, cancelCharge: charge }
  });

  let refund = null;
  if(order.paymentMethod !== 'cod' && order.paymentStatus === 'paid' && refundAmount > 0){
    refund = await prisma.refund.create({
      data: { orderId: order.id, amount: refundAmount, reason, status: 'requested' }
    });
  }

  await notificationService.notify({
    customerId: req.customer.id,
    type: 'order_status',
    title: 'Order cancelled',
    body: refund ? `Your order was cancelled. A refund of ₹${refundAmount.toFixed(2)} has been requested.` : 'Your order was cancelled.',
    orderId: order.id
  });

  res.json({ order: updated, refund, chargeApplied: charge });
}));

// POST /orders/:id/review — brief §23. Only after delivery/pickup, once per order.
router.post('/:id/review', asyncHandler(async (req, res) => {
  const body = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).parse(req.body);
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { review: true } });
  if(!order || order.customerId !== req.customer.id) throw new ApiError(404, 'Order not found');
  if(!isTerminalStatus(order.status) || order.cancelled) throw new ApiError(400, 'You can only review a completed order');
  if(order.review) throw new ApiError(400, 'You have already reviewed this order');

  const review = await prisma.review.create({
    data: {
      orderId: order.id,
      customerId: req.customer.id,
      vendorId: order.vendorId,
      rating: body.rating,
      comment: body.comment || null
    }
  });

  const agg = await prisma.review.aggregate({ where: { vendorId: order.vendorId }, _avg: { rating: true } });
  await prisma.vendor.update({ where: { id: order.vendorId }, data: { rating: Math.round((agg._avg.rating || body.rating) * 10) / 10 } });

  res.status(201).json(review);
}));

module.exports = router;
