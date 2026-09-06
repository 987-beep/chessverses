# ♞ ChessVerse — Realtime Multiplayer Chess

A full **online multiplayer chess platform** with server-authoritative move validation, so **nobody can cheat**. Built to look and feel like chess.com / papergames, and wired to the **live Insforge Postgres** backend.

## Live preview
The app is running as a live preview (the server serves the built client + the realtime Socket.IO connection on the same origin).

## Features
- 🎮 **Realtime 1v1** via WebSockets (Socket.IO) — low latency, auto-reconnect (great for players across India).
- 🛡️ **Server-authoritative rules** — the server validates *every* move with the `chess.js` engine. A client can never play an illegal move, move out of turn, or alter the position.
- 🎯 Full chess rules: legal moves, check, checkmate, stalemate, castling, en passant, promotion, threefold repetition, 50-move rule, insufficient material.
- ⏱️ Clocks with time controls (Bullet/Blitz/Rapid), increments, and an **∞ Utimed / "No time limit"** option (casual games with no clock and no timeout), plus timeout handling.
- 🏆 Quick matchmaking, private rooms with shareable **room codes**, spectating, rematch, resign, draw offers/agreement.
- 💬 In-game chat.
- 👤 Accounts (email/password) with **Elo rating, tiered ranking**, win/loss/draw records, and **guests**.
- 🤝 **Friends system** — send/accept/decline requests, online-status dots, and one-click **friend challenges** (pushed over the existing socket, so no polling/extra network).
- 📈 **Ranking & leaderboard** — tier badges (Beginner → Grandmaster), your ladder position, and progress toward the next tier.
- 👤 **Profile & history** — your stats, rank position, win rate, and recent games.
- 🗄️ Statistics persisted to **Insforge Postgres** (live).

## Low-network design
All realtime state (moves, chat, presence, friend invites) goes over **one persistent WebSocket** with server push — no polling, no busy loops. Friends/ranking/profile are fetched once (on tab open) and can be refreshed on demand; friend challenges and presence live entirely on the existing socket.


## Tech stack
| Layer | Tech |
|------|------|
| Backend | Node.js, Express, **Socket.IO**, `chess.js` |
| Frontend | React 18 + Vite, `react-chessboard` |
| Database | **Insforge Postgres** (via the Insforge `rawsql` admin API) |
| Realtime | Socket.IO WebSockets (server-authoritative) |

## Project layout
```
chess/
├── server/                 # Node + Socket.IO game server (serves the built client too)
│   ├── index.js            # HTTP + Socket.IO entry, auth, matchmaking, rooms, friends, invites
│   ├── gameManager.js      # authoritative game state, move validation, clocks, Elo
│   ├── dbAdapter.js        # Insforge Postgres persistence (parameterized SQL)
│   ├── rank.js             # Elo → rank tier mapping
│   └── config.js           # env-based config (Insforge base URL + API key)
├── client/                 # React frontend (built to client/dist)
│   └── src/
│       ├── rank.js         # client-side tier mapping
│       └── components/     # Auth, Lobby, FriendsPanel, RankingPanel, ProfilePanel, GameScreen…
├── deploy/                 # Insforge deployment guide + Dockerfile
└── backup/                 # backup of the old pre-reset tables (from the clean-up)
```

## Run locally (dev)
```bash
# 1. server
cd server && npm install && npm run dev     # http://localhost:4000 (serves built client)

# 2. (optional) dev client with Vite hot-reload + proxy
cd client && npm install && npm run dev     # http://localhost:5173
```

## Configuration (environment variables)
Create `server/.env`:
```bash
INSFORGE_BASE_URL=https://your-project.region.insforge.app
INSFORGE_API_KEY=ik_your-insforge-api-key-here
DB_MODE=insforge          # 'insforge' = live Insforge Postgres, 'memory' = local
PORT=4000
HOST=0.0.0.0
SESSION_SECRET=change-this-to-a-long-random-string
```

## Deployment
See [`deploy/insforge.md`](deploy/insforge.md) for the full Insforge deployment walkthrough and [`deploy/Dockerfile`](deploy/Dockerfile) for a containerised build.

## Anti-cheat design (why no one can cheat)
1. **The server owns the position.** Clients never set the board — they only *submit* the move they want (`from`, `to`, `promotion`).
2. **The server validates it** with `chess.js` (`try { chess.move(...) } catch`). Illegal moves, wrong-colour moves, and out-of-turn moves are rejected.
3. **The server broadcasts the new authoritative FEN** to everyone; the UI renders from that.
4. Elo, clocks, and results are all computed server-side.

---
*Built with Arena Agent Mode.*
