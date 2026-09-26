const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /tracking/:orderId/stream — Server-Sent Events.
//
// This is the real push architecture the frontend's Services.Tracking
// mock was built to be swapped for (see CUSTOMER_APP_STATUS.md Stage 7):
// replace the frontend's local setInterval simulation with
// `new EventSource('/tracking/'+orderId+'/stream')` and call the
// frontend's existing renderTrackingUI(order) from its onmessage handler
// — no other screen code needs to change.
//
// Implementation note: this polls the database every 2 seconds and only
// pushes when something actually changed. That's a reasonable default
// for order counts a small delivery platform sees; if you later have a
// real rider app pushing GPS coordinates, replace the interval below
// with a subscription to whatever message bus (Redis pub/sub, etc.)
// the rider app publishes to instead of polling Postgres.
router.get('/:orderId/stream', requireAuth, asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
  if(!order || order.customerId !== req.customer.id) throw new ApiError(404, 'Order not found');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  let lastStatusIndex = -1;
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const poll = setInterval(async () => {
    const current = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if(!current){ clearInterval(poll); return res.end(); }
    if(current.statusIndex !== lastStatusIndex){
      lastStatusIndex = current.statusIndex;
      send(current);
    }
    if(current.cancelled || current.statusIndex >= current.statusChain.length - 1){
      clearInterval(poll);
      res.end();
    }
  }, 2000);

  req.on('close', () => clearInterval(poll));
}));

module.exports = router;
