import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * General limiter applied to all routes.
 * 200 requests per 15 minutes per IP — enough for normal browsing.
 */
export const generalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

/**
 * Stricter limiter on the search endpoint — prevents scraping via search.
 * 40 requests per 15 minutes per IP.
 */
export const searchLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Search rate limit exceeded. Please slow down.' },
});
