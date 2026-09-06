# Deploying ChessVerse to Insforge

This project is **already wired to your live Insforge project**:

| Insforge piece | How ChessVerse uses it |
|----------------|------------------------|
| **Postgres** (`profiles`, `games`, `game_chat`, `friends`) | All game/account data is stored here (live, via the `rawsql` admin API) |
| **Realtime** channels (`lobby`, `online`, `game:%`) | The app’s *own* Socket.IO layer is used for the live move/broadcast protocol |
| **Auth** | Email/password accounts are implemented in-app (scrypt hashing, signed tokens) storing to `profiles` |

> Your Insforge DB is already created with the right schema (tables `profiles`, `games`, `game_chat`, `friends`).
> The old test tables were dropped and recreated fresh.

## The one thing to understand about the realtime layer
This game uses a **persistent Node + Socket.IO server** so that the server can be the single source of truth for a game's position, clocks, and move validation. Insforge’s stateless **Deno edge functions** and **static site hosting** cannot hold a long-lived game session or a persistent WebSocket room, which is exactly what server-authoritative chess needs.

So the recommended topology is:

```
Browser  ──WebSocket/HTTP──▶  Your Node server  ──Insforge API──▶  Insforge Postgres
                                    (serves the built React client + Socket.IO)
```

The Node server both **serves the frontend** and **hosts the realtime game rooms**, while **Insforge stays the durability layer** (all data persisted to your live Postgres).

## Option A — Run the container anywhere (recommended)
1. Build the image (see `deploy/Dockerfile`) or run directly:
   ```bash
   npm install && node server/index.js
   ```
2. Set the required Insforge env vars (this is already the default):
   ```bash
   INSFORGE_BASE_URL=https://your-project.region.insforge.app
   INSFORGE_API_KEY=ik_your-insforge-api-key-here
   DB_MODE=insforge
   PORT=4000
   SESSION_SECRET=<your-random-secret>
   ```
3. Run it on any container host that gives you a public origin (Render, Railway, Fly.io, a VPS, or Insforge compute if containers are enabled). It listens on `0.0.0.0:4000`.

That’s it — once it’s up, the site **and** the realtime game protocol are on the same origin, so the browser’s `fetch('/api/...')` and Socket.IO `io()` calls just work.

## Option B — Fully serverless on Insforge (more work)
If you specifically need everything to run as Insforge edge functions + realtime channels (no persistent container), swap the in-memory rooms for the **Insforge realtime channels** as the transport and run move validation in a **Deno edge function**:

1. Deploy a function `validate-move` that reads the current FEN from `games`, applies the move via `chess.js`, rejects if illegal, writes the new FEN back, and `publish`es to the `game:<id>` channel.
2. The client subscribes to `game:<id>` for updates and calls `validate-move` on every attempt.

This keeps everything on Insforge compute, at the cost of: more chatty traffic, having to implement game-over/timeout handling in a stateless context, and a small delay per move. The **server-authoritative** guarantee is preserved (validation still happens in `validate-move`).

## Env-reference
| Var | Purpose |
|-----|---------|
| `INSFORGE_BASE_URL` | Your project URL (e.g. `https://your-project.region.insforge.app`) |
| `INSFORGE_API_KEY` | Anon/API key (`ik_...`) |
| `DB_MODE` | `insforge` (live) or `memory` (dev) |
| `PORT` / `HOST` | HTTP listen port / host (`0.0.0.0`) |
| `SESSION_SECRET` | Secret used to sign auth tokens (change it!) |

## Schema already created on Insforge
- `profiles(id, user_id, email, username, display_name, avatar_url, password_hash, country, bio, elo, wins, losses, draws, games_played, created_at, updated_at)`
- `games(id, code, host_id, guest_id, host_color, fen, pgn, moves, status, time_base, increment, white_ms, black_ms, last_move, winner, over_reason, turn_started_at, created_at, updated_at)`
- `game_chat(id, game_id, user_id, text, created_at)`
- `friends(id, user_id, friend_id, status, created_at)`
