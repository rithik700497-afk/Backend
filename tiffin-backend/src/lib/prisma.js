const { PrismaClient } = require('@prisma/client');

// A single shared Prisma client for the whole process (the recommended
// pattern — creating a new PrismaClient per request exhausts connections).
const prisma = new PrismaClient();

module.exports = prisma;
