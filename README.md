# RepoMind — AI-Powered Codebase Intelligence

RepoMind is a sophisticated, production-ready codebase analysis platform. By combining repository cloning, semantic indexing, and a hybrid local-cloud AI architecture, RepoMind allows developers to interact with and understand complex repositories efficiently.

---

## 🏗️ Architecture Overview

RepoMind has been refactored from a monolithic Next.js application into a robust, decoupled architecture suitable for scalable deployment.

- **Frontend**: Next.js 14, React, Tailwind CSS, Framer Motion. Handles UI presentation, syntax highlighting, and responsive animations.
- **Backend**: Node.js, Express, TypeScript. Handles heavy repository cloning, file traversal, chunking, and AI orchestration.
- **Vector Storage**: SQLite persistence (via `better-sqlite3`) to persist embeddings across sessions, reducing API costs and re-indexing time.
- **AI Inference**: 
  - **Primary**: Lightning-fast inference via **Groq** (Llama 3.3 70B).
  - **Fallback**: Automatic local failover to **Ollama** if cloud services are unavailable.
  - **Embeddings**: Cohere AI (`embed-english-v3.0`).

### Indexing Workflow
1. **Clone**: The backend clones the target GitHub repository to a local `.repos` directory.
2. **Filter & Prioritize**: Binaries, node_modules, and excessive test files are excluded. Core files (README, entry points) receive high chunking caps, while other files are capped to prevent token exhaustion.
3. **Embed & Persist**: Code is chunked intelligently and embedded using Cohere. The vectors and metadata are persisted securely in SQLite.
4. **Synthetic Summary**: A high-level repository summary is generated and injected into the vector store as context anchor.

---

## 🚀 Key Features

- **Instant Repository Processing**: Safe cloning with size and depth protections.
- **Smart Context Retrieval**: Prioritizes the actively viewed file while seamlessly merging in semantic search results and synthetic repo summaries.
- **Deployment Ready**: Fully containerized with Docker and `docker-compose`. Next.js rewrites configured for easy proxying.
- **State-of-the-Art UX**: Immersive animations, file tree exploration, and syntax highlighting.

---

## 🚦 Getting Started (Local Development)

### 1. Prerequisites
- **Node.js** (v18+)
- **Docker** (Optional, for containerized deployment)
- **Ollama**: (Optional for local fallback, run `ollama pull qwen3`)

### 2. Environment Setup
Copy `.env.example` to `.env` in the root directory and populate your keys:
```env
# Backend Configuration
PORT=3001
GROQ_API_KEY=your_groq_key_here
COHERE_API_KEY=your_cohere_key_here

# Frontend Configuration
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### 3. Running the Stack (Manual)

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### 4. Running with Docker Compose
```bash
docker-compose up --build
```

---

## 🌍 Deployment Guide

### Frontend (Vercel)
1. Import the `/frontend` directory as a new Next.js project on Vercel.
2. Set the Environment Variable: `NEXT_PUBLIC_API_URL` to your deployed backend URL (e.g. `https://your-backend.up.railway.app/api`).
3. Deploy.

### Backend (Railway / Render / Fly.io)
1. Create a new Node.js service pointing to the `/backend` directory.
2. Set Environment Variables:
   - `GROQ_API_KEY`
   - `COHERE_API_KEY`
   - `PORT` (usually 3001 or provided by the host)
3. Ensure the deployment environment provides a persistent disk volume for `/app/data` (SQLite database) and `/app/.repos` (cloned repos) if you want caching across restarts.

---

## 🔮 Future Improvements
- **Multi-Tenant Support**: Isolate SQLite databases per user session.
- **Webhooks**: Automatically re-index repositories on `push` events.
- **Advanced Graph RAG**: Incorporate AST parsing for structural code understanding.

---
*RepoMind — Understanding code, one chunk at a time.*
