import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Configure dotenv
dotenv.config();

// Fallback to parent directory (.env.local) if we are in development and backend/.env is missing
const rootEnvLocalPath = path.resolve(process.cwd(), '..', '.env.local');
if (fs.existsSync(rootEnvLocalPath)) {
  dotenv.config({ path: rootEnvLocalPath, override: false });
}

console.log('COHERE_API_KEY:', process.env.COHERE_API_KEY ? '✅ loaded' : '❌ MISSING');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✅ loaded' : '❌ MISSING');
console.log('MISTRAL_API_KEY:', process.env.MISTRAL_API_KEY ? '✅ loaded' : '❌ MISSING');

if (!process.env.COHERE_API_KEY) {
  throw new Error('COHERE_API_KEY is not set in .env');
}
