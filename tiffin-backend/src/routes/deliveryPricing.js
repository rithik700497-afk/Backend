const express = require('express');
const { z } = require('zod');
const deliveryPricingService = require('../services/deliveryPricingService');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// POST /delivery-pricing/quote  { distanceKm }
// Public — checkout needs this before the customer is necessarily logged
// in to a session the server trusts yet (though in this app they will be).
router.post('/quote', asyncHandler(async (req, res) => {
  const distanceKm = z.number().nonnegative().parse(req.body.distanceKm);
  const fee = await deliveryPricingService.quote(distanceKm);
  res.json({ distanceKm, fee });
}));

module.exports = router;
