import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Chess } from 'chess.js';
import { config } from './config.js';
import * as db from './dbAdapter.js';
import * as gm from './gameManager.js';
import { tierForElo } from './rank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ------------------------- auth helpers ------------------------- */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(password, s, 64).toString('hex');
  return `${s}:${h}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [s, h] = stored.split(':');
  const h2 = crypto.scryptSync(password, s, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(h2, 'hex'));
}
function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  if (sig !== exp) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
}
async function resolveUser(token) {
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  const p = await db.getProfileByUserId(claims.sub);
  if (!p) return null;
  return { id: p.user_id, username: p.username, name: p.display_name || p.username, rating: p.elo || 1200, avatar: p.avatar_url, guest: false };
}

// Guest identities are stored in uuid-typed columns, so always coerce to a real UUID.
function ensureUuid(id) {
  if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  return crypto.randomUUID();
}
// Never let a persistence error take the whole game server down.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.message || e));

/* ------------------------- REST ------------------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true, name: config.appName, time: new Date().toISOString(), rooms: gm.allRooms().size }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email = '', password = '', username = '', display_name = '' } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    const existing = await db.getProfileByEmail(email);
    if (existing) return res.status(409).json({ error: 'an account with this email already exists' });
    if (await db.getProfileByUsername(username)) return res.status(409).json({ error: 'username already taken' });
    const uname = username || email.split('@')[0];
    const uid = crypto.randomUUID();
    const prof = await db.createProfile({ user_id: uid, email, username: uname, display_name: display_name || uname, password_hash: hashPassword(password) });
    const token = signToken(prof.user_id);
    res.json({ token, user: { id: prof.user_id, username: prof.username, name: prof.display_name, rating: prof.elo, email: prof.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const p = await db.getProfileByEmail(email);
    if (!p || !verifyPassword(password, p.password_hash)) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken(p.user_id);
    res.json({ token, user: { id: p.user_id, username: p.username, name: p.display_name, rating: p.elo, email: p.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', async (req, res) => {
  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const u = await resolveUser(auth);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: u });
});

app.get('/api/leaderboard', async (_req, res) => {
  try { res.json(await db.listLeaderboard(25)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- auth-required routes ----
const bearerOf = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, '');
async function authedUser(req, res) {
  const u = await resolveUser(bearerOf(req));
  if (!u) { res.status(401).json({ error: 'unauthorized' }); return null; }
  return u;
}

app.get('/api/friends', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  try {
    const friends = await db.listFriends(u.id);
    res.json({ friends: friends.map((f) => ({ ...f, online: isOnline(f.friend_user_id) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/friends/requests', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  try {
    const [incoming, outbound] = await Promise.all([db.incomingRequests(u.id), db.outboundRequests(u.id)]);
    res.json({ incoming: incoming.map((r) => ({ ...r, online: isOnline(r.user_id) })), outbound });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/request', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const target = await db.getProfileByUsername(username);
    if (!target) return res.status(404).json({ error: 'no player with that username' });
    if (target.user_id === u.id) return res.status(400).json({ error: 'you cannot add yourself' });
    const status = await db.requestFriend(u.id, target.user_id);
    res.json({ status, user: { id: target.user_id, username: target.username, display_name: target.display_name, elo: target.elo } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/accept', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  const ok = await db.acceptFriendRequest(u.id, req.body?.requestId).catch(() => false);
  res.json({ ok });
});
app.post('/api/friends/decline', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  await db.declineFriendRequest(u.id, req.body?.requestId).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/friends/cancel', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  await db.cancelFriendRequest(u.id, req.body?.requestId).catch(() => {});
  res.json({ ok: true });
});
app.delete('/api/friends/:userId', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  await db.removeFriend(u.id, req.params.userId).catch(() => {});
  res.json({ ok: true });
});
app.get('/api/online', async (req, res) => {
  const u = await authedUser(req, res); if (!u) return;
  res.json({ online: [...onlineUsers.keys()] });
});

// ---- profile & history ----
app.get('/api/profile/:username', async (req, res) => {
  try {
    const p = await db.getProfileByUsername(req.params.username);
    if (!p) return res.status(404).json({ error: 'profile not found' });
    const myPos = p.user_id ? await db.rankPosition(p.user_id) : null;
    const total = await db.totalProfiles();
    res.json({
      profile: {
        username: p.username, display_name: p.display_name, avatar_url: p.avatar_url,
        elo: p.elo, wins: p.wins, losses: p.losses, draws: p.draws, games_played: p.games_played,
        country: p.country, bio: p.bio, userId: p.user_id,
        grade: tierForElo(p.elo),
      },
      rank: { position: myPos, total },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/profile/:username/games', async (req, res) => {
  try {
    const p = await db.getProfileByUsername(req.params.username);
    if (!p) return res.status(404).json({ error: 'profile not found' });
    const games = await db.recentGamesForUser(p.user_id, 20);
    res.json({ games });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/games/open', async (_req, res) => {
  try { res.json(await db.listOpenGames()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/game/:code', async (req, res) => {
  try {
    const inMem = findRoomByCode(req.params.code);
    if (inMem) return res.json({ game: gm.roomPublic(inMem) });
    const row = await db.getGameByCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'game not found' });
    res.json({ game: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function findRoomByCode(code) {
  for (const r of gm.allRooms().values()) if (r.code === code) return r;
  return null;
}

// Send the current authoritative game state to every socket in a room, each with
// its own `youAre` color. Crucial: when the second player joins and the game
// starts, the player who created the room must ALSO be notified (otherwise they
// stay stuck on "Waiting" and nobody can move since it's their turn).
function emitJoined(room, io) {
  for (const c of ['w', 'b']) {
    const p = room.players[c];
    if (!p || !p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('game:joined', { game: gm.roomPublic(room, s.data.user), youAre: c });
  }
  for (const sid of room.spectators.keys()) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit('game:joined', { game: gm.roomPublic(room, s.data.user), youAre: null, spectating: true });
  }
}

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

// Normalize a time-control value, preserving explicit 0 (0 is falsy so `||` breaks it).
const normTC = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

/* ------------------------- Socket.IO ------------------------- */
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000, pingInterval: 15000,
});

const queue = new Map(); // key -> [ {socket,user}, ... ]
const invites = new Map(); // inviteId -> { fromId, fromName, fromSocketId, toId, time_base, increment }
const onlineUsers = new Map(); // userId -> Set(socketId)

function markOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}
function markOffline(userId, socketId) {
  const s = onlineUsers.get(userId);
  if (s) { s.delete(socketId); if (!s.size) onlineUsers.delete(userId); }
}
function isOnline(userId) { return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0; }

io.on('connection', (socket) => {
  socket.data.user = null;

  socket.on('auth', async (payload = {}, cb) => {
    let user = null;
    if (payload.token) user = await resolveUser(payload.token);
    if (!user && payload.guest) {
      const gid = ensureUuid(payload.guestId);
      user = { id: gid, username: payload.name || 'Guest', name: (payload.name || 'Guest').slice(0, 20), rating: 1000, guest: true };
    }
    socket.data.user = user;
    if (user) markOnline(user.id, socket.id);
    if (cb) cb({ ok: !!user, user });
    if (user) { await sendLobby(socket); }
  });

  socket.on('lobby:join', async () => { socket.join('lobby'); await sendLobby(socket); });
  socket.on('lobby:list', async () => await sendLobby(socket));

  async function sendLobby(s) {
    const [games, board] = await Promise.all([
      db.listOpenGames().catch(() => []),
      db.listLeaderboard(15).catch(() => []),
    ]);
    s.emit('lobby:state', { games, leaderboard: board });
  }

  /* ---- Quick match queue ---- */
  socket.on('queue:join', (payload = {}, cb) => {
    const user = socket.data.user;
    if (!user) return cb && cb({ ok: false, reason: 'authenticate first' });
    const key = `${normTC(payload.time_base, 600)}-${normTC(payload.increment, 0)}`;
    if (!queue.has(key)) queue.set(key, []);
    const q = queue.get(key);
    if (q.some((e) => e.socket.id === socket.id)) return cb && cb({ ok: true, queued: true });
    q.push({ socket, user });
    socket.emit('queue:status', { queued: true, key });
    tryMatch(key);
    cb && cb({ ok: true, queued: true });
  });
  socket.on('queue:cancel', (payload = {}) => {
    const key = `${normTC(payload.time_base, 600)}-${normTC(payload.increment, 0)}`;
    const q = queue.get(key);
    if (q) { const i = q.findIndex((e) => e.socket.id === socket.id); if (i >= 0) { q.splice(i, 1); socket.emit('queue:status', { queued: false }); } }
  });

  function tryMatch(key) {
    const q = queue.get(key);
    if (!q || q.length < 2) return;
    const a = q.shift(), b = q.shift();
    // Prefer non-guest as white for fairness; random otherwise.
    let white, black;
    if (a.user.guest === b.user.guest) { [white, black] = Math.random() < 0.5 ? [a, b] : [b, a]; }
    else { white = a.user.guest ? b : a; black = white === a ? b : a; }
    const [tb, inc] = key.split('-').map(Number);
    const room = gm.generateRoom(null, { time_base: tb, increment: inc });
    assignPlayer(room, white.socket, white.user, 'w');
    assignPlayer(room, black.socket, black.user, 'b');
    gm.startGame(io, room);
    joinBoth(room, [white.socket, black.socket]);
    db.createGame({
      id: room.id, code: room.code, host_id: white.user.id, guest_id: black.user.id,
      host_color: 'w', fen: room.chess.fen(), pgn: '', moves: [], status: 'playing',
      time_base: tb, increment: inc, white_ms: room.clocks.w, black_ms: room.clocks.b,
      turn_started_at: new Date().toISOString(),
    }).catch((e) => console.error('createGame err', e.message));
  }

  function assignPlayer(room, sock, user, color) {
    room.players[color] = { ...user, color, connected: true, socketId: sock.id };
    sock.data.currentRoom = room.id;
  }

  function joinBoth(room, sockets) {
    for (const s of sockets) { s.join(`game:${room.id}`); }
    for (const s of sockets) {
      s.emit('game:joined', { game: gm.roomPublic(room, s.data.user), youAre: colorForSocket(room, s.id) });
    }
  }
  function colorForSocket(room, sid) {
    for (const c of ['w', 'b']) if (room.players[c] && room.players[c].socketId === sid) return c;
    return null;
  }

  /* ---- Create a custom game (public or private-friend) ---- */
  socket.on('game:create', async (payload = {}, cb) => {
    const user = socket.data.user;
    if (!user) return cb && cb({ ok: false, reason: 'authenticate first' });
    const tb = normTC(payload.time_base, 600);
    const inc = normTC(payload.increment, 0);
    const hostColor = payload.host_color === 'b' ? 'b' : 'w';
    const room = gm.generateRoom(null, { time_base: tb, increment: inc, host_color: hostColor });
    assignPlayer(room, socket, user, hostColor);
    socket.join(`game:${room.id}`);
    socket.emit('game:joined', { game: gm.roomPublic(room, user), youAre: hostColor });
    const row = await db.createGame({
      id: room.id, code: room.code, host_id: user.id, host_color: hostColor,
      fen: room.chess.fen(), pgn: '', moves: [], status: 'open',
      time_base: tb, increment: inc, white_ms: room.clocks.w, black_ms: room.clocks.b,
      turn_started_at: null,
    }).catch((e) => { console.error('createGame err', e.message); return null; });
    await sendLobby(socket);
    cb && cb({ ok: true, gameId: room.id, code: room.code });
  });

  /* ---- Join a game by code ---- */
  socket.on('game:join', async (payload = {}, cb) => {
    const user = socket.data.user;
    const code = String(payload.code || '').toUpperCase();
    if (!user) return cb && cb({ ok: false, reason: 'authenticate first' });
    let room = findRoomByCode(code);
    if (!room) {
      const row = await db.getGameByCode(code).catch(() => null);
      if (!row) return cb && cb({ ok: false, reason: 'game not found' });
      room = gm.generateRoom(null, {
        id: row.id, code: row.code, time_base: row.time_base, increment: row.increment, host_color: row.host_color,
      });
      room.chess = new Chess(row.fen);
      room.moves = row.moves || [];
      if (room.time.unlimited) {
        room.clocks = { w: Infinity, b: Infinity };
        room.timeStartedAt = null;
      } else {
        room.clocks = { w: row.white_ms ?? room.time.baseMs, b: row.black_ms ?? room.time.baseMs };
        room.timeStartedAt = row.turn_started_at ? new Date(row.turn_started_at).getTime() : null;
      }
      room.status = row.status;
      if (row.winner) room.result = { winner: row.winner, reason: row.over_reason };
      else if (row.status === 'over') room.result = { winner: null, reason: row.over_reason };
      // restore player identities
      if (row.host_id) { const p = await db.getProfileByUserId(row.host_id); if (p) room.players.w = { id: p.user_id, name: p.display_name || p.username, rating: p.elo || 1200, color: 'w', connected: false }; }
      if (row.guest_id) { const p = await db.getProfileByUserId(row.guest_id); if (p) room.players.b = { id: p.user_id, name: p.display_name || p.username, rating: p.elo || 1200, color: 'b', connected: false }; }
    }
    let color = null;
    for (const c of ['w', 'b']) {
      if (room.players[c] && room.players[c].id === user.id) color = c;
    }
    if (!color) {
      color = setPlayerOrNull(room, socket, user);
      if (!color) {
        // spectate instead
        room.spectators.set(socket.id, user.name);
        socket.join(`game:${room.id}`);
        socket.emit('game:joined', { game: gm.roomPublic(room, user), youAre: null, spectating: true });
        return cb && cb({ ok: true, spectating: true });
      }
    }
    if (room.players[color]) room.players[color].connected = true;
    await swapSocket(room, socket, color);
    socket.join(`game:${room.id}`);
    gm.startGame(io, room);
    // Notify BOTH players (and any spectators) with their own color — this is what
    // makes the game actually begin on the host's screen too.
    emitJoined(room, io);
    if (room.status === 'playing' && room.players.b) {
      try {
        await db.updateGame(room.id, { guest_id: room.players.b.id, status: 'playing', turn_started_at: room.timeStartedAt ? new Date(room.timeStartedAt).toISOString() : null });
      } catch (e) { console.error('join updateGame err', e.message); }
    }
    cb && cb({ ok: true, youAre: color, gameId: room.id });
  });

  function setPlayerOrNull(room, sock, user) {
    let color = null;
    if (!room.players.w) color = 'w'; else if (!room.players.b) color = 'b';
    if (!color) return null;
    room.players[color] = { ...user, color, connected: true, socketId: sock.id };
    return color;
  }
  async function swapSocket(room, sock, color) {
    const old = room.players[color];
    if (old) old.connected = true;
    room.players[color] = { ...(room.players[color] || {}), ...sock.data.user, color, connected: true, socketId: sock.id };
    sock.data.currentRoom = room.id;
  }

  /* ---- Spectate ---- */
  socket.on('game:spectate', async (payload = {}, cb) => {
    const id = payload.id;
    let room = gm.getRoom(id);
    if (!room) { const row = await db.getGame(id).catch(() => null); if (!row) return cb && cb({ ok: false, reason: 'game not found' }); }
    if (!room) return cb && cb({ ok: false, reason: 'not available' });
    room.spectators.set(socket.id, socket.data.user?.name || 'Spectator');
    socket.join(`game:${room.id}`);
    socket.emit('game:joined', { game: gm.roomPublic(room, socket.data.user), youAre: null, spectating: true });
    cb && cb({ ok: true });
  });

  /* ---- Game actions ---- */
  socket.on('game:move', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom);
    if (!room) return cb && cb({ ok: false, reason: 'no game' });
    const r = gm.applyMove(io, room, socket.id, { from: payload.from, to: payload.to, promotion: payload.promotion });
    cb && cb(r);
  });
  socket.on('game:resign', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom);
    if (!room) return cb && cb({ ok: false });
    const r = gm.resign(io, room, socket.id); cb && cb(r);
  });
  socket.on('game:offerDraw', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom);
    if (!room) return cb && cb({ ok: false }); cb && cb(gm.offerDraw(io, room, socket.id));
  });
  socket.on('game:acceptDraw', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom);
    if (!room) return cb && cb({ ok: false }); cb && cb(gm.acceptDraw(io, room, socket.id));
  });
  socket.on('game:agreeDraw', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom);
    if (!room) return cb && cb({ ok: false }); cb && cb(gm.agreeDraw(io, room, socket.id));
  });
  socket.on('game:declineDraw', (payload) => {
    const room = gm.getRoom(socket.data.currentRoom); if (room) gm.declineDraw(io, room);
  });
  socket.on('game:rematch', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom); if (!room) return cb && cb({ ok: false }); cb && cb(gm.rematch(io, room, socket.id));
  });
  socket.on('game:chat', (payload, cb) => {
    const room = gm.getRoom(socket.data.currentRoom); if (!room) return cb && cb({ ok: false }); cb && cb(gm.chat(io, room, socket.id, payload.text));
  });

  /* ---- Friend invites (pushed over the existing socket => no polling) ---- */
  socket.on('friend:invite', (payload = {}, cb) => {
    const u = socket.data.user;
    if (!u) return cb && cb({ ok: false, reason: 'authenticate first' });
    const to = payload.to;
    if (!to || to === u.id) return cb && cb({ ok: false });
    const target = onlineUsers.get(to);
    if (!target || target.size === 0) return cb && cb({ ok: false, reason: 'friend is offline' });
    const time_base = normTC(payload.time_base, 600);
    const increment = normTC(payload.increment, 0);
    const inviteId = crypto.randomUUID();
    const fromSocketId = socket.id;
    invites.set(inviteId, { fromId: u.id, fromName: u.name, fromSocketId, toId: to, time_base, increment, createdAt: Date.now() });
    for (const sid of target) {
      io.to(sid).emit('friend:invite', {
        inviteId, from: { id: u.id, name: u.name },
        time_base, increment, unlimited: time_base === 0,
      });
    }
    cb && cb({ ok: true });
  });

  socket.on('friend:inviteAccept', async (payload = {}, cb) => {
    const inv = invites.get(payload.inviteId);
    const accepter = socket.data.user;
    if (!inv || !accepter || accepter.id !== inv.toId) return cb && cb({ ok: false, reason: 'invite not found' });
    invites.delete(payload.inviteId);
    const room = gm.generateRoom(null, { time_base: inv.time_base, increment: inv.increment });
    const fromSocketId = inv.fromSocketId;
    const fromColor = Math.random() < 0.5 ? 'w' : 'b';
    const toColor = fromColor === 'w' ? 'b' : 'w';
    room.players[fromColor] = { id: inv.fromId, name: inv.fromName, rating: 1200, color: fromColor, connected: true, socketId: fromSocketId };
    room.players[toColor] = { id: accepter.id, name: accepter.name, rating: accepter.rating || 1200, color: toColor, connected: true, socketId: socket.id };
    gm.startGame(io, room);
    const fromSock = io.sockets.sockets.get(fromSocketId);
    if (fromSock) { fromSock.join(`game:${room.id}`); fromSock.data.currentRoom = room.id; }
    socket.join(`game:${room.id}`); socket.data.currentRoom = room.id;
    db.createGame({
      id: room.id, code: room.code, host_id: inv.fromId, guest_id: accepter.id,
      host_color: fromColor, fen: room.chess.fen(), pgn: '', moves: [], status: 'playing',
      time_base: inv.time_base, increment: inv.increment, white_ms: room.time.unlimited ? 0 : room.clocks.w,
      black_ms: room.time.unlimited ? 0 : room.clocks.b,
      turn_started_at: room.timeStartedAt ? new Date(room.timeStartedAt).toISOString() : null,
    }).catch((e) => console.error('invite createGame err', e.message));
    if (fromSock) fromSock.emit('game:joined', { game: gm.roomPublic(room, { id: inv.fromId, name: inv.fromName }), youAre: fromColor });
    socket.emit('game:joined', { game: gm.roomPublic(room, accepter), youAre: toColor });
    cb && cb({ ok: true });
  });

  socket.on('friend:inviteDecline', (payload = {}) => {
    invites.delete(payload.inviteId);
  });

  socket.on('disconnect', () => {
    const user = socket.data.user;
    if (user) {
      markOffline(user.id, socket.id);
      // Drop any invites this socket created or was meant to receive.
      for (const [id, inv] of invites) {
        if (inv.fromSocketId === socket.id || inv.toId === user.id) invites.delete(id);
      }
    }
    // Remove from queue if present
    for (const [k, q] of queue) { const i = q.findIndex((e) => e.socket.id === socket.id); if (i >= 0) q.splice(i, 1); }
    // Mark player disconnected
    for (const room of gm.allRooms().values()) {
      for (const c of ['w', 'b']) {
        if (room.players[c] && room.players[c].socketId === socket.id) {
          room.players[c].connected = false;
          gm.broadcast(io, room, 'game:presence', { color: c, connected: false });
        }
      }
      room.spectators.delete(socket.id);
    }
  });

  socket.on('getProfiles', async (payload = {}, cb) => {
    const list = await db.listLeaderboard(50).catch(() => []);
    cb && cb({ ok: true, list });
  });
});

/* ------------------------- clock tick ------------------------- */
setInterval(() => {
  const flags = gm.tick();
  for (const { room, winner } of flags) gm.endGame(io, room, winner, 'timeout');
  for (const room of gm.allRooms().values()) {
    if (room.status === 'playing' && room.timeStartedAt) {
      io.to(`game:${room.id}`).emit('game:clock', gm.clockState(room));
    }
  }
}, 1000);

// Garbage-collect finished rooms so long-running servers don't leak memory.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of gm.allRooms()) {
    if (room.status === 'over' && now - room.createdAt > 10 * 60 * 1000) {
      gm.removeRoom(id);
    }
  }
}, 60 * 1000);

httpServer.listen(config.port, config.host, () => {
  console.log(`[${config.appName}] server listening on http://${config.host}:${config.port}`);
  console.log(`[${config.appName}] db mode: ${config.dbMode} | insforge: ${config.insforgeBaseUrl}`);
});
