const prisma = require('../lib/prisma');

/**
 * Returns the delivery fee for a given distance, read from the
 * DeliverySlab table (seeded with the same ₹10/₹20/₹30/₹40/₹55 example
 * slabs the frontend mock uses) instead of a hardcoded number anywhere in
 * code — an admin can change pricing by editing rows, no deploy needed.
 */
async function quote(distanceKm){
  const slabs = await prisma.deliverySlab.findMany({ orderBy: { sortOrder: 'asc' } });
  const slab = slabs.find(s => distanceKm <= s.maxKm) || slabs[slabs.length - 1];
  return slab ? slab.fee : 0;
}

module.exports = { quote };
