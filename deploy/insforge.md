# Deploying ChessVerse so it actually works

This is a **realtime multiplayer game**. The React site and the Node + Socket.IO
game server must run together — the browser calls `/api/...` and opens a WebSocket
to a **persistent** server that owns the game state (rooms, clocks, move validation).

> Vercel's static hosting can't run that persistent server, so a direct Vercel
> deploy of the *site only* will 404 and the game won't connect. Fix: host the
> whole app as **one container** using the bundled `Dockerfile`.

## Recommended: host everything as one container (works out of the box)

The repo ships with a root `Dockerfile` that:
1. builds the React client, and
2. runs the game server which serves that client **and** Socket.IO on **one origin**.

So the browser always talks to the same origin — no CORS, no `VITE_SERVER_URL` needed.

### Option A — Render (native Node runtime — recommended)
This app deploys most reliably on Render with its **native Node runtime** (no Docker),
which builds the React client and runs the game server directly. Render supports
WebSockets, so the realtime Socket.IO layer works fine.

1. Push this repo to GitHub (done). In **Render → New → Blueprint**, select this repo.
   It reads `render.yaml` (runtime: node) and creates a web service automatically.
2. In the service's **Environment**, set:
   - `INSFORGE_BASE_URL` = `https://your-project.region.insforge.app`  ← **must be your real URL**
   - `INSFORGE_API_KEY` = *(your real key)* — mark as **Secret**
   - `SESSION_SECRET` — auto-generated, leave it
3. **Deploy**. Render builds (`cd client && npm install --include=dev && npm run build && cd ../server && npm install`)
   and starts `node server/index.js`. You get a public URL that serves the realtime game.

> **Why `--include=dev`?** Render sets `NODE_ENV=production`, which makes plain `npm install`
> skip devDependencies — including `vite` — causing `vite: not found` / build failure.
> `--include=dev` forces them in for the build.
>
> If the Docker build previously failed with "Cannot find module /app/server/index.js",
> that was a Dockerfile bug (server source wasn't copied) — now fixed. We use native
> Node runtime on Render to avoid Docker entirely. *(A corrected root `Dockerfile` is
> still committed for Railway/Fly.)*

### Option B — Fly.io (fast, low latency, free-ish)
```bash
fly launch --no-deploy --name chessverse
fly secrets set INSFORGE_API_KEY=ik_... SESSION_SECRET="$(openssl rand -hex 24)"
fly deploy
```
`fly.toml` already sets the region (Mumbai, good for India), the port, and a
`/api/health` check.

### Option C — Railway
New Project → Deploy from GitHub repo → enter the env vars → deploy. Railway
auto-detects the root `Dockerfile`.

## Option D — Keep Vercel for the site + a separate backend
Only if you specifically want the static frontend on Vercel:
1. Host the backend (the `Dockerfile`) on Render/Railway/Fly → get `https://backend-url`.
2. In **Vercel** settings: **Root Directory = `client`**, Framework preset **Vite**,
   Build = `npm run build`, Output = `dist`. (A `client/vercel.json` is included.)
3. Add a Vercel env var: `VITE_SERVER_URL = https://backend-url`.
   The client is already coded to read it and route all `/api` + Socket.IO calls there.

## Env variables
| Var | Purpose |
|-----|---------|
| `INSFORGE_BASE_URL` | Your project URL |
| `INSFORGE_API_KEY` | Anon/API key (keep as a **secret**) |
| `DB_MODE` | `insforge` (live) or `memory` (dev) |
| `PORT` / `HOST` | `4000` / `0.0.0.0` |
| `SESSION_SECRET` | Signing secret (random string) |
| `VITE_SERVER_URL` | (Vercel split-host only) backend origin |

## Verify after deploy
- `GET /api/health` → `{"ok":true,...}`
- Open the site → Play as Guest → Create/Join a room in two tabs → the game plays.
