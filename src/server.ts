import 'node:process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { getDb, closeDb } from './db/client.js';
import { registerRoutes } from './routes/index.js';
import { generalLimiter } from './middleware/rate-limit.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4001);

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// CORS — only allow configured origins
// ---------------------------------------------------------------------------
const rawOrigins = process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header) and listed origins.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" is not allowed`));
      }
    },
    methods: ['GET'],          // read-only API
    allowedHeaders: ['Content-Type', 'x-internal-secret'],
  }),
);

// ---------------------------------------------------------------------------
// Body / compression
// ---------------------------------------------------------------------------
app.use(compression());
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting (applied globally; search gets a stricter limiter in its router)
// ---------------------------------------------------------------------------
app.use(generalLimiter);

// ---------------------------------------------------------------------------
// Health check — no auth, no rate limit concern
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
registerRoutes(app);

// ---------------------------------------------------------------------------
// 404 fallthrough
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
getDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] Pure Ingredia API listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[server] Failed to connect to MongoDB:', err);
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  console.log('[server] Shutting down...');
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
