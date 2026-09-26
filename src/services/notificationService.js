const prisma = require('../lib/prisma');

/**
 * Records an in-app notification and, if a push provider is configured,
 * also sends a real push. This is the single place order-status changes,
 * payment updates, and refund updates go through, so GET /notifications
 * and real push (once wired) never drift out of sync.
 *
 * DEV MODE (default, when PUSH_PROVIDER is unset): only writes to the
 * Notification table — no real push is sent, matching this project's
 * pattern of being explicit about what's simulated rather than silently
 * pretending a push went out.
 *
 * brief §25 asks that customers can control PROMOTIONAL notifications
 * specifically — order/payment/refund updates are transactional and are
 * ALWAYS sent regardless of preference. Only `type: 'promo'` /
 * `'flash_offer'` is ever skipped, and only when the customer has set
 * Customer.promoOptOut. This function is the single choke point both the
 * in-app feed and any future real push go through, so the opt-out can
 * never be bypassed by calling one and not the other.
 */
const PROMOTIONAL_TYPES = new Set(['promo', 'flash_offer']);

async function notify({ customerId, type, title, body, orderId }){
  if(PROMOTIONAL_TYPES.has(type)){
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { promoOptOut: true }
    });
    if(customer && customer.promoOptOut) return null; // respected the opt-out; nothing written, nothing pushed
  }

  const notification = await prisma.notification.create({
    data: { customerId, type, title, body, orderId: orderId || null }
  });

  if(process.env.PUSH_PROVIDER){
    await sendRealPush(customerId, { title, body }, { type, orderId: orderId || '', notificationId: notification.id });
  }

  return notification;
}

/**
 * Stage 10: the real push send, guarded so a push failure never breaks
 * the caller — order-status updates, refunds, etc. must still succeed
 * and the in-app feed (already written above) must still work even if
 * the push provider is down or a token is stale. Errors are logged, not
 * thrown.
 */
async function sendRealPush(customerId, { title, body }, data){
  const tokens = await prisma.deviceToken.findMany({ where: { customerId }, select: { token: true } });
  if(!tokens.length) return; // customer has never registered a device — nothing to push to

  try {
    const provider = process.env.PUSH_PROVIDER === 'apns' ? require('../lib/push/apns') : require('../lib/push/fcm');
    const { invalidTokens } = await provider.sendToTokens(tokens.map(t => t.token), { title, body }, data);
    if(invalidTokens.length){
      await prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
    }
  } catch(err){
    console.error('Push send failed (in-app notification was still recorded):', err.message);
  }
}

module.exports = { notify };
