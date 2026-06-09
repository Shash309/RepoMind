import './prestart';
import express from 'express';
import cors from 'cors';
import cloneRoutes from './routes/clone';
import chatRoutes from './routes/chat';
import fileRoutes from './routes/file';
import readmeRoutes from './routes/readme';
import actRoutes from './routes/act';
import riskRadarRoutes from './routes/riskRadar';

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

// --- CORS ---
// Allow requests from the Vercel frontend and localhost in development.
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL, // e.g. https://repomind.vercel.app
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Render health checks, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));

// --- Health Check (required by Render) ---
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Routes ---
app.use('/api/clone', cloneRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/file', fileRoutes);
app.use('/api/generate-readme', readmeRoutes);
app.use('/api/act', actRoutes);
app.use('/api/risk-radar', riskRadarRoutes);

// --- Centralized Error Handler ---
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// --- Start ---
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ RepoMind backend running on port ${port}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origins: ${allowedOrigins.join(', ')}`);
});

server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 300000;
