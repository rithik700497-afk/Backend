const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { signStaffSession } = require('../lib/staffJwt');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();

const phoneSchema = z.string().regex(/^[0-9]{10}$/, 'Enter a valid 10-digit mobile number');
const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1) });

// POST /staff/auth/vendor-login — restaurant/store staff. Replaces sending
// X-Admin-Key for the vendor-facing ops actions in routes/admin.js.
router.post('/vendor-login', asyncHandler(async (req, res) => {
  const { phone, password } = loginSchema.parse(req.body);
  const staff = await prisma.vendorStaff.findUnique({ where: { phone } });
  if(!staff || !staff.isActive || !(await bcrypt.compare(password, staff.passwordHash))){
    throw new ApiError(401, 'Invalid phone or password');
  }
  const token = signStaffSession({ id: staff.id, role: 'vendor', vendorId: staff.vendorId });
  res.json({ token, staff: { id: staff.id, name: staff.name, vendorId: staff.vendorId, role: staff.role } });
}));

// POST /staff/auth/rider-login
router.post('/rider-login', asyncHandler(async (req, res) => {
  const { phone, password } = loginSchema.parse(req.body);
  const rider = await prisma.rider.findUnique({ where: { phone } });
  if(!rider || !rider.isActive || !(await bcrypt.compare(password, rider.passwordHash))){
    throw new ApiError(401, 'Invalid phone or password');
  }
  const token = signStaffSession({ id: rider.id, role: 'rider' });
  res.json({ token, rider: { id: rider.id, name: rider.name, vehicle: rider.vehicle, plate: rider.plate } });
}));

// POST /staff/auth/superadmin — trades the platform-ops shared secret
// (ADMIN_API_KEY) for a short-lived superadmin session token, so even the
// one remaining shared secret in the system isn't sent on every request —
// only once, to mint a token that expires in hours, not indefinitely.
// Superadmin exists ONLY to provision/deactivate vendor-staff and rider
// accounts (see POST /admin/vendor-staff, /admin/riders below) and as a
// break-glass fallback for the operational routes — it is deliberately
// not meant to be anyone's daily-driver login.
router.post('/superadmin', asyncHandler(async (req, res) => {
  const key = req.body.adminKey || req.headers['x-admin-key'];
  if(!process.env.ADMIN_API_KEY){
    throw new ApiError(500, 'ADMIN_API_KEY is not configured on the server');
  }
  if(!key || key !== process.env.ADMIN_API_KEY){
    throw new ApiError(401, 'Invalid admin key');
  }
  const token = signStaffSession({ id: 'superadmin', role: 'superadmin' });
  res.json({ token });
}));

module.exports = router;
