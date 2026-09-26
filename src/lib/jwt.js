const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

if(!SECRET){
  // Fail loudly at boot rather than silently signing tokens with
  // `undefined` as the secret.
  throw new Error('JWT_SECRET is not set — copy .env.example to .env and set it.');
}

function signSession(customer){
  // The token carries only the customer id — never anything sensitive.
  // Every route that needs the customer's current data re-reads it from
  // the database rather than trusting stale claims in the token.
  return jwt.sign({ sub: customer.id }, SECRET, { expiresIn: EXPIRES_IN });
}

function verifySession(token){
  return jwt.verify(token, SECRET); // throws if invalid/expired
}

module.exports = { signSession, verifySession };
