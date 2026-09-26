const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// GET /notifications
router.get('/', asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { customerId: req.customer.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(notifications);
}));

// POST /notifications/:id/read
router.post('/:id/read', asyncHandler(async (req, res) => {
  const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if(!existing || existing.customerId !== req.customer.id) throw new ApiError(404, 'Notification not found');
  const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { readAt: new Date() } });
  res.json(updated);
}));

// POST /notifications/read-all
router.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { customerId: req.customer.id, readAt: null },
    data: { readAt: new Date() }
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Device tokens (Stage 10) — what a real push send in notificationService
// fans out to. The frontend calls POST on app start / login once it has
// obtained a token from the platform's push SDK (Firebase for
// Android/iOS/web), and DELETE on logout so a shared/reset device stops
// receiving that customer's pushes.
// ---------------------------------------------------------------------
router.post('/device-token', asyncHandler(async (req, res) => {
  const { token, platform } = z.object({
    token: z.string().min(10),
    platform: z.enum(['android', 'ios', 'web'])
  }).parse(req.body);

  // upsert on token (unique) — a token migrating to a different logged-in
  // customer (shared/reset device) should move with them, not duplicate.
  await prisma.deviceToken.upsert({
    where: { token },
    update: { customerId: req.customer.id, platform },
    create: { customerId: req.customer.id, token, platform }
  });
  res.status(201).json({ ok: true });
}));

router.delete('/device-token', asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  await prisma.deviceToken.deleteMany({ where: { token, customerId: req.customer.id } });
  res.json({ ok: true });
}));

module.exports = router;
