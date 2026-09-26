const { verifyStaffSession } = require('../lib/staffJwt');
const prisma = require('../lib/prisma');

/**
 * The real replacement for requireAdmin.js's shared ADMIN_API_KEY.
 * Verifies a `Authorization: Bearer <token>` issued by
 * POST /staff/auth/vendor-login or POST /staff/auth/rider-login, re-reads
 * the account from the database (so a deactivated account is rejected
 * immediately, not just once its token expires), and attaches:
 *
 *   req.staff = { id, role: 'vendor'|'rider'|'superadmin', vendorId? }
 *
 * `allowedRoles` restricts which role(s) may pass — e.g.
 * requireStaff(['vendor','superadmin']) for restaurant/store actions,
 * requireStaff(['rider','superadmin']) for delivery actions. Routes that
 * accept a vendor account are responsible for also checking
 * req.staff.vendorId matches the resource being touched (see
 * routes/admin.js's `assertOwnsVendor` helper) — this middleware only
 * proves who the caller is, not what they're allowed to touch.
 */
function requireStaff(allowedRoles){
  return async function(req, res, next){
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if(!token){
      return res.status(401).json({ error: 'Missing staff session token' });
    }
    let payload;
    try {
      payload = verifyStaffSession(token);
    } catch(e){
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if(allowedRoles && !allowedRoles.includes(payload.role)){
      return res.status(403).json({ error: 'Not permitted for this role' });
    }

    if(payload.role === 'vendor'){
      const staff = await prisma.vendorStaff.findUnique({ where: { id: payload.sub } });
      if(!staff || !staff.isActive) return res.status(401).json({ error: 'Account no longer active' });
      req.staff = { id: staff.id, role: 'vendor', vendorId: staff.vendorId };
    } else if(payload.role === 'rider'){
      const rider = await prisma.rider.findUnique({ where: { id: payload.sub } });
      if(!rider || !rider.isActive) return res.status(401).json({ error: 'Account no longer active' });
      req.staff = { id: rider.id, role: 'rider' };
    } else if(payload.role === 'superadmin'){
      // Superadmin tokens are issued directly from ADMIN_API_KEY (see
      // routes/staffAuth.js) — there's no deactivatable row to re-check.
      req.staff = { id: 'superadmin', role: 'superadmin' };
    } else {
      return res.status(401).json({ error: 'Unrecognized session role' });
    }

    req.isAdmin = true; // kept for any legacy code path that still reads this
    next();
  };
}

module.exports = { requireStaff };
