const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// POST /coupons/validate  { code, mode, subtotal }
// Requires login so per-user usage limits (brief §20) can be enforced —
// never trust a client-computed discount, this is the one source of truth.
router.post('/validate', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    code: z.string().min(1),
    mode: z.enum(['food', 'grocery']),
    subtotal: z.number().nonnegative()
  }).parse(req.body);

  const coupon = await prisma.coupon.findUnique({ where: { code: body.code.toUpperCase() } });
  if(!coupon || !coupon.isActive || coupon.mode !== body.mode){
    return res.json({ valid: false, reason: 'Invalid or inapplicable coupon code' });
  }
  if(coupon.expiresAt && coupon.expiresAt < new Date()){
    return res.json({ valid: false, reason: 'This coupon has expired' });
  }
  if(body.subtotal < coupon.minOrder){
    return res.json({ valid: false, reason: `Minimum order of ₹${coupon.minOrder} required for this coupon` });
  }
  if(coupon.usageLimit != null){
    const totalUses = await prisma.order.count({ where: { couponId: coupon.id, cancelled: false } });
    if(totalUses >= coupon.usageLimit){
      return res.json({ valid: false, reason: 'This coupon has reached its usage limit' });
    }
  }
  const usesByThisCustomer = await prisma.order.count({
    where: { couponId: coupon.id, customerId: req.customer.id, cancelled: false }
  });
  if(usesByThisCustomer >= coupon.perUserLimit){
    return res.json({ valid: false, reason: 'You have already used this coupon' });
  }

  const raw = coupon.type === 'percent' ? body.subtotal * coupon.value / 100 : coupon.value;
  const discount = Math.round(Math.min(raw, coupon.maxDiscount) * 100) / 100;

  res.json({ valid: true, discount, coupon: { id: coupon.id, code: coupon.code, desc: coupon.desc } });
}));

module.exports = router;
