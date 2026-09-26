const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const otpService = require('../services/otpService');
const { signSession } = require('../lib/jwt');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const phoneSchema = z.string().regex(/^[0-9]{10}$/, 'Enter a valid 10-digit mobile number');

// POST /auth/otp/request  — replaces Services.Auth.requestOtp() in the frontend
router.post('/otp/request', asyncHandler(async (req, res) => {
  const phone = phoneSchema.parse(req.body.phone);
  const result = await otpService.requestOtp(phone);

  const isDev = !process.env.OTP_PROVIDER;
  res.json({
    sent: true,
    // devCode is ONLY ever included when no real SMS provider is
    // configured — this mirrors the frontend's own honest "Demo mode"
    // banner. Remove this field entirely once OTP_PROVIDER is set; the
    // check below already does that for you.
    ...(isDev ? { devCode: result.devCode } : {})
  });
}));

// POST /auth/otp/verify  — replaces Services.Auth.verifyOtp() in the frontend
router.post('/otp/verify', asyncHandler(async (req, res) => {
  const phone = phoneSchema.parse(req.body.phone);
  const code = z.string().min(4).max(6).parse(req.body.code);
  const name = req.body.name ? z.string().min(1).max(80).parse(req.body.name) : undefined;

  const result = await otpService.verifyOtp(phone, code);
  if(!result.ok){
    throw new ApiError(400, 'Invalid or expired code');
  }

  let customer = await prisma.customer.findUnique({ where: { phone } });
  const isNewCustomer = !customer;
  if(!customer){
    // First time we've seen this phone — the frontend's "name capture"
    // screen only appears for genuinely new numbers; enforce that here too.
    if(!name){
      return res.status(200).json({ ok: true, isNewCustomer: true }); // caller should collect a name and retry
    }
    customer = await prisma.customer.create({ data: { phone, name } });
  }

  const token = signSession(customer);
  res.json({
    ok: true,
    isNewCustomer,
    token,
    customer: { id: customer.id, phone: customer.phone, name: customer.name }
  });
}));

// GET /auth/me  — the frontend calls this on boot instead of trusting a
// locally-stored name/phone as "logged in": if the token is invalid, this
// 401s and the frontend should send the customer back to Login.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ id: req.customer.id, phone: req.customer.phone, name: req.customer.name, promoOptOut: req.customer.promoOptOut });
}));

// PATCH /auth/me — Stage 9 (brief §25): the one customer-editable
// preference so far is whether PROMOTIONAL notifications are on. Kept on
// the customer's own profile route rather than under /notifications,
// since it's account-level, not tied to any one notification.
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const promoOptOut = typeof req.body.promoOptOut === 'boolean' ? req.body.promoOptOut : undefined;
  const customer = await prisma.customer.update({
    where: { id: req.customer.id },
    data: { ...(promoOptOut !== undefined ? { promoOptOut } : {}) }
  });
  res.json({ id: customer.id, phone: customer.phone, name: customer.name, promoOptOut: customer.promoOptOut });
}));

// POST /auth/logout — stateless JWTs can't be server-invalidated without
// a blocklist; this endpoint exists for symmetry/audit logging and so the
// frontend has a single real call to make on logout. If you need true
// server-side revocation, add a token-blocklist table and check it in
// requireAuth().
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true });
}));

module.exports = router;
