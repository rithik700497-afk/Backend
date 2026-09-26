const express = require('express');
const prisma = require('../lib/prisma');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
// Public — browsing active flash offers doesn't require login, same as
// the rest of the catalog.

// GET /flash-offers?vendorId=
// Only returns currently-live offers (startsAt <= now <= expiresAt) —
// expired ones simply stop appearing rather than the client having to
// filter them out itself.
router.get('/', asyncHandler(async (req, res) => {
  const now = new Date();
  const where = { startsAt: { lte: now }, expiresAt: { gte: now } };
  if(req.query.vendorId) where.vendorId = req.query.vendorId;
  const offers = await prisma.flashOffer.findMany({ where, include: { vendor: true }, orderBy: { expiresAt: 'asc' } });
  res.json(offers);
}));

module.exports = router;
