const { verifySession } = require('../lib/jwt');
const prisma = require('../lib/prisma');

// Protects a route: requires a valid `Authorization: Bearer <token>`
// header, issued by POST /auth/otp/verify. This is the real replacement
// for the frontend's device-local "session marker" — the frontend should
// store this token (not the customer's phone/name) as its session and
// send it on every authenticated request.
async function requireAuth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token){
    return res.status(401).json({ error: 'Missing session token' });
  }
  try {
    const payload = verifySession(token);
    const customer = await prisma.customer.findUnique({ where: { id: payload.sub } });
    if(!customer){
      return res.status(401).json({ error: 'Session no longer valid' });
    }
    req.customer = customer;
    next();
  } catch(e){
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };
