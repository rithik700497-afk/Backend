const crypto = require('crypto');

/**
 * Starts a charge for an order. In production this creates a real order/
 * intent with your gateway (Razorpay, Stripe, PayU, etc.) and returns
 * whatever the client SDK needs to collect payment.
 *
 * DEV MODE (default, when PAYMENT_GATEWAY_KEY is unset): simulates a
 * gateway round trip and reports success ~88% of the time — the same
 * rate the frontend's own mock uses, so the failure/retry UI stays
 * exercised in local testing without a real gateway account.
 *
 * CRITICAL: whichever mode this runs in, the caller (see
 * src/routes/payments.js) must NEVER mark an order "paid" directly from
 * this function's return value in production — only a verified webhook
 * (verifyWebhookSignature below) may do that. This function is fine to
 * trust in dev mode specifically because dev mode has no real money and
 * no real webhook to wait for.
 */
async function charge({ orderId, amount, method }){
  if(process.env.PAYMENT_GATEWAY_KEY){
    // TODO: call your real gateway here, e.g.:
    // const intent = await razorpay.orders.create({ amount: amount*100, currency:'INR', receipt: orderId });
    // return { gatewayRef: intent.id, status: 'processing' }; // real status arrives via webhook, not here
    throw new Error('PAYMENT_GATEWAY_KEY is set but no gateway integration is implemented yet — see src/services/paymentGatewayService.js');
  }

  await new Promise(r => setTimeout(r, 500));
  const success = Math.random() < 0.88;
  return {
    gatewayRef: 'DEV_PAY_' + Date.now(),
    status: success ? 'paid' : 'failed'
  };
}

/**
 * Verifies that a webhook actually came from your payment gateway before
 * trusting its contents. Real gateways sign their webhook payloads with a
 * secret — this is where you check that signature. Wire this up before
 * going live; until then, POST /payments/webhook rejects all webhooks
 * outright rather than trusting an unverified one (see routes/payments.js).
 */
function verifyWebhookSignature({ rawBody, signatureHeader }){
  if(!process.env.PAYMENT_GATEWAY_SECRET) return false;
  // Example HMAC pattern — replace with your gateway's actual scheme:
  // const expected = crypto.createHmac('sha256', process.env.PAYMENT_GATEWAY_SECRET).update(rawBody).digest('hex');
  // return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader || ''));
  return false;
}

module.exports = { charge, verifyWebhookSignature };
