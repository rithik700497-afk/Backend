const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// GET /favorites
router.get('/', asyncHandler(async (req, res) => {
  const favorites = await prisma.favorite.findMany({
    where: { customerId: req.customer.id },
    include: { vendor: true, product: true }
  });
  res.json(favorites);
}));

// POST /favorites  { vendorId? , productId? }  — exactly one of the two
router.post('/', asyncHandler(async (req, res) => {
  const body = z.object({
    vendorId: z.string().nullable().optional(),
    productId: z.string().nullable().optional()
  }).parse(req.body);
  if(!body.vendorId === !body.productId){ // both set or both empty
    throw new ApiError(400, 'Provide exactly one of vendorId or productId');
  }
  const favorite = await prisma.favorite.upsert({
    where: {
      customerId_vendorId_productId: {
        customerId: req.customer.id,
        vendorId: body.vendorId || null,
        productId: body.productId || null
      }
    },
    update: {},
    create: { customerId: req.customer.id, vendorId: body.vendorId || null, productId: body.productId || null }
  });
  res.status(201).json(favorite);
}));

// DELETE /favorites  { vendorId? , productId? }
router.delete('/', asyncHandler(async (req, res) => {
  const body = z.object({
    vendorId: z.string().nullable().optional(),
    productId: z.string().nullable().optional()
  }).parse(req.body);
  await prisma.favorite.deleteMany({
    where: { customerId: req.customer.id, vendorId: body.vendorId || null, productId: body.productId || null }
  });
  res.json({ ok: true });
}));

module.exports = router;
