const jwt = require('jsonwebtoken');

// Separate secret from customer sessions (lib/jwt.js) on purpose: a leaked
// customer JWT_SECRET should never let someone forge a vendor/rider/
// superadmin token, and vice versa. Falls back to JWT_SECRET only if
// STAFF_JWT_SECRET isn't set, so existing single-secret deployments don't
// break on upgrade — but a real production deploy should set both.
const SECRET = process.env.STAFF_JWT_SECRET || process.env.JWT_SECRET;
const EXPIRES_IN = process.env.STAFF_JWT_EXPIRES_IN || '12h'; // short-lived: ops staff share shop devices, unlike a customer's own phone

if(!SECRET){
  throw new Error('STAFF_JWT_SECRET (or JWT_SECRET) is not set — copy .env.example to .env and set it.');
}

// role: 'vendor' | 'rider' | 'superadmin'
// vendorId: only set (and only meaningful) for role 'vendor'
function signStaffSession({ id, role, vendorId }){
  return jwt.sign({ sub: id, role, ...(vendorId ? { vendorId } : {}) }, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyStaffSession(token){
  return jwt.verify(token, SECRET); // throws if invalid/expired
}

module.exports = { signStaffSession, verifyStaffSession };
