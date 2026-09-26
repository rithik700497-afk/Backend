const express = require('express');
const prisma = require('../lib/prisma');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();
// Browsing is intentionally public (no requireAuth) — a customer should
// be able to look at restaurants/stores before logging in, same as the
// frontend's Home/Categories screens work today.

// GET /catalog/vendors?mode=food|grocery
router.get('/vendors', asyncHandler(async (req, res) => {
  const mode = req.query.mode;
  if(mode && mode !== 'food' && mode !== 'grocery') throw new ApiError(400, 'mode must be food or grocery');
  const vendors = await prisma.vendor.findMany({ where: mode ? { mode } : undefined, orderBy: { rating: 'desc' } });
  res.json(vendors);
}));

// GET /catalog/vendors/:id
router.get('/vendors/:id', asyncHandler(async (req, res) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if(!vendor) throw new ApiError(404, 'Vendor not found');
  res.json(vendor);
}));

// GET /catalog/vendors/:id/products?category=
router.get('/vendors/:id/products', asyncHandler(async (req, res) => {
  const where = { vendorId: req.params.id };
  if(req.query.category) where.category = req.query.category;
  const products = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });
  res.json(products);
}));

// GET /catalog/products/:id
router.get('/products/:id', asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if(!product) throw new ApiError(404, 'Product not found');
  res.json(product);
}));

// GET /catalog/vendors/:id/reviews
router.get('/vendors/:id/reviews', asyncHandler(async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { vendorId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  res.json(reviews);
}));

// GET /catalog/search?mode=food&q=butter&sort=rating|fastest|price
// Powers the frontend's debounced Search screen.
router.get('/search', asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'grocery' ? 'grocery' : 'food';
  const q = (req.query.q || '').trim();
  const sort = req.query.sort || 'relevance';

  let vendors = await prisma.vendor.findMany({ where: { mode } });
  let products = await prisma.product.findMany({ where: { mode } });

  if(q){
    const needle = q.toLowerCase();
    vendors = vendors.filter(v => v.name.toLowerCase().includes(needle) || v.tags.some(t => t.toLowerCase().includes(needle)));
    products = products.filter(p => p.name.toLowerCase().includes(needle) || p.category.toLowerCase().includes(needle));
  }

  if(sort === 'rating') vendors = vendors.sort((a,b) => b.rating - a.rating);
  else if(sort === 'fastest') vendors = vendors.sort((a,b) => a.etaMin - b.etaMin);
  else if(sort === 'price') products = products.sort((a,b) => a.price - b.price);

  res.json({ vendors, products });
}));

module.exports = router;
