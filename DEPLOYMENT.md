# RepoMind — Deployment Guide

## Architecture

```
/frontend   → Vercel (Next.js)
/backend    → Render (Express + Node)
```

Each service deploys **independently**. The frontend proxies `/api/*` requests to the Render backend URL via Next.js rewrites.

---

## 1 — Deploy the Backend on Render

### Service settings
| Field | Value |
|---|---|
| **Runtime** | Node |
| **Root Directory** | `backend` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start` |
| **Health Check Path** | `/health` |

### Persistent Disk (required for SQLite)
| Field | Value |
|---|---|
| **Name** | `repomind-data` |
| **Mount Path** | `/opt/render/project/src/data` |
| **Size** | 1 GB |

> **Why?** Render's filesystem is ephemeral. Without a persistent disk the SQLite database is wiped on every redeploy.

### Environment Variables (set in Render dashboard)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` *(Render sets this automatically — do NOT override)* |
| `GROQ_API_KEY` | your Groq key |
| `COHERE_API_KEY` | your Cohere key |
| `OPENAI_API_KEY` | optional |
| `FRONTEND_URL` | `https://your-app.vercel.app` |

> Alternatively, use the `render.yaml` blueprint at the repo root and click **"New Blueprint Instance"** in Render.

---

## 2 — Deploy the Frontend on Vercel

### Service settings
| Field | Value |
|---|---|
| **Framework** | Next.js |
| **Root Directory** | `frontend` |
| **Build Command** | `next build` *(auto-detected)* |
| **Install Command** | `npm install --legacy-peer-deps` |

### Environment Variables (set in Vercel dashboard → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.onrender.com` |

> This is the **only** env var the frontend needs. `next.config.mjs` uses it to rewrite `/api/*` to the Render backend automatically. No localhost in production.

---

## 3 — Local Development

```bash
# Terminal 1 — Backend
cd backend
cp .env.example .env   # fill in your keys
npm install
npm run dev            # starts on localhost:3001

# Terminal 2 — Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev            # starts on localhost:3000
# Leave NEXT_PUBLIC_API_URL unset — next.config.mjs falls back to localhost:3001
```

---

## 4 — Post-Deploy Checklist

- [ ] Backend `/health` returns `{"status":"ok"}`
- [ ] `NEXT_PUBLIC_API_URL` set to your Render URL on Vercel
- [ ] `FRONTEND_URL` set to your Vercel URL on Render (for CORS)
- [ ] Persistent disk mounted on Render
- [ ] `GROQ_API_KEY` and `COHERE_API_KEY` set on Render
