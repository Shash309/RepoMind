# RepoMind — AI-Powered Codebase Intelligence (v1.0)

RepoMind is a sophisticated codebase analysis platform designed for developers who need to understand complex repositories quickly. By combining repository cloning, semantic indexing, and a hybrid local-cloud AI architecture, RepoMind allows you to treat your codebase as a living, conversational partner.

---

## 🚀 Key Features

- **Instant Repository Cloning**: Clone any public GitHub repository directly into the workspace for immediate analysis.
- **Smart Tiered Indexing**: A custom-built RAG pipeline that prioritizes critical files (READMEs, entry points, config files) while intelligently capping less relevant code to stay within context limits.
- **Hybrid AI Architecture**: 
  - **Primary**: Lightning-fast inference via **Groq** (Llama 3.3 70B).
  - **Fallback**: Automatic local failover to **Ollama** (Qwen3) if cloud services are unavailable.
- **Deep Context Awareness**: 
  - **Active File Priority**: The system automatically detects which file you are viewing and prioritizes its content in the chat.
  - **Synthetic Repo Summaries**: Generates a comprehensive overview of the folder structure and key dependencies at index time.
- **Premium Developer Experience**: 
  - Interactive File Explorer.
  - Code Viewer with full syntax highlighting.
  - Streaming AI responses with automatic reasoning (think-tag) stripping.

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 14, React, Tailwind CSS, Framer Motion.
- **Backend**: Next.js API Routes (Serverless).
- **Embeddings**: Cohere AI (`embed-english-v3.0`) for high-precision semantic search.
- **LLMs**: Groq & Ollama.
- **Vector Store**: Custom high-performance in-memory vector database with cosine similarity.

---

## 🚦 Getting Started

### 1. Prerequisites
- **Node.js** (v18+)
- **Ollama**: (Optional but recommended for local fallback)
  - [Download Ollama](https://ollama.com/)
  - Run `ollama pull qwen3`
- **API Keys**:
  - [Cohere API Key](https://dashboard.cohere.com/api-keys)
  - [Groq API Key](https://console.groq.com/keys)

### 2. Environment Setup
Create a `.env.local` file in the root directory:
```env
COHERE_API_KEY=your_cohere_key_here
GROQ_API_KEY=your_groq_key_here
```

### 3. Installation
```bash
npm install
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📂 Project Structure

- `src/app/api/`: Backend endpoints for cloning, indexing, and chat logic.
- `src/components/`: Modular UI components (Chat, File Explorer, Landing Page).
- `src/lib/`: Core utilities for vector search, LLM orchestration, and GitHub interaction.
- `src/types/`: Shared TypeScript definitions.

---

## 📜 Version History
- **v1.0 (Current)**: Initial release featuring hybrid AI, smart chunking, and interactive repository exploration.

---

## 👨‍💻 Author
**Shash309**

---
*RepoMind — Understanding code, one chunk at a time.*
