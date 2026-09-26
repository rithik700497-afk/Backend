// Wraps an async route handler so a thrown error / rejected promise is
// forwarded to Express's error handler instead of crashing the process.
function asyncHandler(fn){
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// A small typed error you can throw from anywhere in a route handler:
// throw new ApiError(400, 'Coupon code is required')
class ApiError extends Error {
  constructor(status, message){
    super(message);
    this.status = status;
  }
}

// Express error-handling middleware (note the 4 args — that's what makes
// Express treat this as an error handler). Mounted last in app.js.
function errorHandler(err, req, res, next){
  const status = err.status || 500;
  if(status === 500){
    // Only log unexpected errors loudly — expected 4xx (bad coupon, no
    // stock, etc.) are normal traffic, not incidents.
    console.error(err);
  }
  res.status(status).json({ error: err.message || 'Something went wrong' });
}

module.exports = { asyncHandler, ApiError, errorHandler };
