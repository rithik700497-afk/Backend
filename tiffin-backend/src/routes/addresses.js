const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth); // every route below requires a logged-in customer

const addressSchema = z.object({
  label: z.enum(['Home', 'Work', 'Other']),
  name: z.string().min(1),
  phone: z.string().regex(/^[0-9]{10}$/),
  address: z.string().min(1),
  landmark: z.string().optional().default(''),
  area: z.string().optional().default(''),
  city: z.string().min(1),
  pin: z.string().min(4).max(6),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional()
});

router.get('/', asyncHandler(async (req, res) => {
  const addresses = await prisma.address.findMany({
    where: { customerId: req.customer.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
  });
  res.json(addresses);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = addressSchema.parse(req.body);
  const existingCount = await prisma.address.count({ where: { customerId: req.customer.id } });
  const address = await prisma.address.create({
    data: { ...data, customerId: req.customer.id, isDefault: existingCount === 0 }
  });
  res.status(201).json(address);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = addressSchema.partial().parse(req.body);
  const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
  if(!existing || existing.customerId !== req.customer.id) throw new ApiError(404, 'Address not found');
  const address = await prisma.address.update({ where: { id: req.params.id }, data });
  res.json(address);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
  if(!existing || existing.customerId !== req.customer.id) throw new ApiError(404, 'Address not found');
  await prisma.address.delete({ where: { id: req.params.id } });
  if(existing.isDefault){
    const next = await prisma.address.findFirst({ where: { customerId: req.customer.id }, orderBy: { createdAt: 'asc' } });
    if(next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  res.json({ ok: true });
}));

router.post('/:id/set-default', asyncHandler(async (req, res) => {
  const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
  if(!existing || existing.customerId !== req.customer.id) throw new ApiError(404, 'Address not found');
  await prisma.address.updateMany({ where: { customerId: req.customer.id }, data: { isDefault: false } });
  const address = await prisma.address.update({ where: { id: req.params.id }, data: { isDefault: true } });
  res.json(address);
}));

module.exports = router;
