const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const paymentGateway = require('../services/paymentGatewayService');

const router = express.Router();

// POST /payments/:orderId/charge — starts payment for an order.
//
// In DEV MODE (no PAYMENT_GATEWAY_KEY set) this endpoint also resolves
// the payment synchronously and updates the order, since there's no real
// webhook to wait for — same shortcut the frontend's own mock takes.
//
// In PRODUCTION (gateway configured), this only STARTS the charge and
// returns whatever the gateway needs for the client to complete payment
// (e.g. a Razorpay order id). The order's paymentStatus stays
// "processing" until POST /payments/webhook receives a verified
// confirmation — this route must never set paymentStatus to "paid".
router.post('/:orderId/charge', requireAuth, asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
  if(!order || order.customerId !== req.customer.id) throw new ApiError(404, 'Order not found');
  if(order.paymentMethod === 'cod') throw new ApiError(400, 'This order is Cash on Delivery — nothing to charge');

  const result = await paymentGateway.charge({ orderId: order.id, amount: order.total, method: order.paymentMethod });

  const isDevMode = !process.env.PAYMENT_GATEWAY_KEY;
  const newStatus = isDevMode ? result.status : 'processing';

  const payment = await prisma.payment.upsert({
    where: { orderId: order.id },
    update: { gatewayRef: result.gatewayRef, status: newStatus, method: order.paymentMethod, amount: order.total },
    create: { orderId: order.id, gatewayRef: result.gatewayRef, status: newStatus, method: order.paymentMethod, amount: order.total }
  });
  await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: newStatus, paymentId: result.gatewayRef } });

  res.json({ paymentId: result.gatewayRef, status: newStatus });
}));

// POST /payments/webhook — the ONLY route allowed to mark a payment
// "paid" in production. Real gateways call this server-to-server; it is
// never invoked by the frontend app directly (brief §10: "Payment
// confirmation must come from the backend/payment gateway verification").
router.post('/webhook', express.raw({ type: '*/*' }), asyncHandler(async (req, res) => {
  const signature = req.headers['x-gateway-signature']; // adjust to your gateway's actual header name
  const verified = paymentGateway.verifyWebhookSignature({ rawBody: req.body, signatureHeader: signature });
  if(!verified){
    // Reject unverified webhooks outright rather than trusting them —
    // this fires for every request until verifyWebhookSignature() is
    // actually implemented for your chosen gateway (see
    // src/services/paymentGatewayService.js).
    throw new ApiError(401, 'Unable to verify webhook signature');
  }

  // TODO: parse the verified payload per your gateway's schema, then:
  // const { gatewayRef, status } = parsedPayload;
  // await prisma.payment.update({ where: { gatewayRef }, data: { status, rawWebhook: parsedPayload } });
  // await prisma.order.update({ where: { id: orderIdForThisPayment }, data: { paymentStatus: status } });

  res.json({ received: true });
}));

module.exports = router;
