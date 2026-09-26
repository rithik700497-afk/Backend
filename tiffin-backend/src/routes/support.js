const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['Refund issue','Missing item','Wrong item','Late delivery','Payment issue','Cancellation issue','Other'];

// POST /support/tickets
router.post('/tickets', asyncHandler(async (req, res) => {
  const body = z.object({
    category: z.enum(CATEGORIES),
    message: z.string().min(1).max(2000),
    orderId: z.string().nullable().optional()
  }).parse(req.body);

  if(body.orderId){
    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    if(!order || order.customerId !== req.customer.id) throw new ApiError(400, 'Order not found');
  }

  const ticket = await prisma.supportTicket.create({
    data: { customerId: req.customer.id, category: body.category, message: body.message, orderId: body.orderId || null }
  });
  res.status(201).json(ticket);
}));

// GET /support/tickets — the customer's own tickets, most recent first
router.get('/tickets', asyncHandler(async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { customerId: req.customer.id },
    orderBy: { createdAt: 'desc' }
  });
  res.json(tickets);
}));

// GET /support/tickets/:id
router.get('/tickets/:id', asyncHandler(async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if(!ticket || ticket.customerId !== req.customer.id) throw new ApiError(404, 'Ticket not found');
  res.json(ticket);
}));

module.exports = router;
