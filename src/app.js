const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const addressRoutes = require('./routes/addresses');
const catalogRoutes = require('./routes/catalog');
const deliveryPricingRoutes = require('./routes/deliveryPricing');
const couponRoutes = require('./routes/coupons');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const trackingRoutes = require('./routes/tracking');
const favoriteRoutes = require('./routes/favorites');
const supportRoutes = require('./routes/support');
const notificationRoutes = require('./routes/notifications');
const flashOfferRoutes = require('./routes/flashOffers');
const adminRoutes = require('./routes/admin');
const staffAuthRoutes = require('./routes/staffAuth');

const app = express();

app.set('trust proxy', 1); // needed for correct client IPs / rate limiting behind Render/Railway/etc.'s proxy

app.use(helmet());
app.use(compression());

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }));

app.use(morgan('dev'));
app.use(express.json());

// Generous global limit (mainly a backstop against abuse/bugs, not meant
// to be felt in normal use) plus a tight limit specifically on OTP
// requests, since that's the endpoint most worth protecting from being
// hammered (SMS costs money, and it's the one unauthenticated write route
// in the whole API).
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many OTP requests — please wait a few minutes and try again.' } });
app.use('/auth/otp/request', otpLimiter);

// Stage 10 (brief §37 security pass): a tight limit on every login attempt
// that checks a password (vendor-staff, rider, superadmin) — the other
// unauthenticated write endpoint worth protecting against brute-forcing,
// same reasoning as the OTP limiter above.
const staffLoginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts — please wait a few minutes and try again.' } });
app.use('/staff/auth', staffLoginLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/addresses', addressRoutes);
app.use('/catalog', catalogRoutes);
app.use('/delivery-pricing', deliveryPricingRoutes);
app.use('/coupons', couponRoutes);
app.use('/orders', orderRoutes);
app.use('/payments', paymentRoutes);
app.use('/tracking', trackingRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/support', supportRoutes);
app.use('/notifications', notificationRoutes);
app.use('/flash-offers', flashOfferRoutes);
app.use('/admin', adminRoutes);
app.use('/staff/auth', staffAuthRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler); // must be registered last

module.exports = app;
