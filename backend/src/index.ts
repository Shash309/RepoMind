import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cloneRoutes from './routes/clone';
import chatRoutes from './routes/chat';
import fileRoutes from './routes/file';
import readmeRoutes from './routes/readme';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/clone', cloneRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/file', fileRoutes);
app.use('/api/generate-readme', readmeRoutes);

// Centralized error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
