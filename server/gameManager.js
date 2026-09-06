// gameManager.js — server-authoritative game state, matchmaking, and Elo.
// Every move is validated here (via chess.js), so clients cannot cheat.
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { config } from './config.js';
import * as db from './dbAdapter.js';

const codes = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
};

// room: {
//   id, code, hostId,
//   chess: Chess,
//   moves: [{from,to,promotion,san,piece,captured,color}],
//   time: { baseMs, incMs },
//   clocks: { w: ms, b: ms },
//   timeStartedAt,
//   players: { w: player|null, b: player|null },  // player = {id,name,rating,color,connected}
//   status: 'open'|'playing'|'over',
//   result: { winner, reason }|null,
//   drawOffer: boolean, drawBy: color|null,
//   rematchVotes: [color, ...],
//   spectators: Map<socketId, name>,
//   chatEnabled: true,
//   createdAt
// }
export const rooms = new Map();

function publicPlayer(p) {
  return p ? { id: p.id, name: p.name, rating: p.rating, color: p.color, connected: p.connected } : null;
}

function roomToPublic(room, forUser) {
  const pFor = (gameColor) => {
    const p = room.players[gameColor];
    if (!p) return null;
    return { id: p.id, name: p.name, rating: p.rating, connected: p.connected };
  };
  let myColor = null;
  if (forUser) {
    if (room.players.w && room.players.w.id === forUser.id) myColor = 'w';
    else if (room.players.b && room.players.b.id === forUser.id) myColor = 'b';
  }
  return {
    id: room.id, code: room.code, status: room.status,
    fen: room.chess.fen(), turn: room.chess.turn(),
    moves: room.moves,
    clocks: { w: room.clocks.w, b: room.clocks.b },
    time: { baseMs: room.time.baseMs, incMs: room.time.incMs, baseSec: room.time.baseSec, incSec: room.time.incSec, unlimited: room.time.unlimited },
    white: pFor('w'), black: pFor('b'),
    youAre: myColor, lastMove: room.moves[room.moves.length - 1]?.last || null,
    result: room.result, drawOffer: room.drawOffer, drawBy: room.drawBy,
    check: room.chess.inCheck(), myColor,
    spectators: room.spectators.size,
  };
}

export function generateRoom(player, opts = {}) {
  // A `time_base` of 0 means "no time limit" (untimed / casual). Clocks are
  // never deducted and the game can never end on time.
  const rawBase = opts.time_base;
  const baseSec = rawBase === 0 ? 0 : (Number.isFinite(+rawBase) && +rawBase > 0 ? +rawBase : 600);
  const incSec = Number.isFinite(+opts.increment) && +opts.increment > 0 ? +opts.increment : 0;
  const unlimited = baseSec === 0;
  const baseMs = unlimited ? Infinity : baseSec * 1000;
  const incMs = incSec * 1000;

  const room = {
    id: opts.id || crypto.randomUUID(), code: opts.code || codes(),
    chess: new Chess(),
    moves: [],
    time: { baseMs, incMs, baseSec, incSec, unlimited },
    clocks: { w: unlimited ? Infinity : baseMs, b: unlimited ? Infinity : baseMs },
    timeStartedAt: null,
    players: { w: null, b: null },
    status: 'open',
    result: null, drawOffer: false, drawBy: null,
    rematchVotes: [], spectators: new Map(), chatEnabled: true,
    createdAt: Date.now(),
    hostColor: opts.host_color || 'w',
  };
  if (player) room.players[room.hostColor] = { ...player, color: room.hostColor };
  rooms.set(room.id, room);
  return room;
}

export function setPlayer(room, socketId, player) {
  // Join as a player only if there's a free side.
  let color = null;
  if (!room.players.w) color = 'w';
  else if (!room.players.b) color = 'b';
  if (!color) return null;
  room.players[color] = { ...player, color, connected: true, socketId };
  return color;
}

export function spectatorJoin(room, socketId, name) {
  room.spectators.set(socketId, name);
}

export function playerSockets(io, room) {
  // gather socket ids of both players to place them into the socket.io room
  const ids = [];
  for (const c of ['w', 'b']) if (room.players[c]) ids.push(room.players[c].socketId);
  return ids;
}

export function broadcast(io, room, event, payload) {
  io.to(`game:${room.id}`).emit(event, payload);
}

export function startGame(io, room) {
  if (room.players.w && room.players.b && room.status === 'open') {
    room.status = 'playing';
    // Untimed games have no running clock (timeStartedAt stays null so nothing is deducted).
    room.timeStartedAt = room.time.unlimited ? null : Date.now();
    room.chess = new Chess();
    const now = new Date().toISOString();
    db.updateGame(room.id, { status: 'playing', turn_started_at: now }).catch(() => {});
  }
}

/* ------------------------- move handling ------------------------- */
export function applyMove(io, room, socketId, m) {
  const color = colorFor(room, socketId);
  if (!color) return { ok: false, reason: 'you are not a player' };
  if (room.status !== 'playing') return { ok: false, reason: 'game is not active' };
  if (room.chess.turn() !== color) return { ok: false, reason: 'not your turn' };

  // Ensure the mover's clock is still positive (prevent out-of-time moves).
  // Clock is deducted in real time in index.js; also enforce a safety check here.
  if (room.clocks[color] <= 0) {
    endGame(io, room, opp(color), 'flag', socketId);
    return { ok: false, reason: 'time is up' };
  }

  const from = m.from, to = m.to, promotion = m.promotion;
  let result;
  try {
    result = room.chess.move({ from, to, promotion });
  } catch (e) {
    return { ok: false, reason: `illegal move: ${e.message}` };
  }

  // SAN/verbose move
  const move = {
    from, to, promotion: result.promotion || null,
    san: result.san, color, piece: result.piece,
    captured: result.captured || null,
    flags: result.flags,
    last: { from, to, promotion: result.promotion || null, san: result.san, color },
  };
  room.moves.push(move);

  // Deduct elapsed time for the mover and add increment (untimed games skip this).
  if (!room.time.unlimited) {
    const spent = room.timeStartedAt ? Date.now() - room.timeStartedAt : 0;
    room.clocks[color] = Math.max(0, room.clocks[color] - spent + room.time.incMs);
    room.timeStartedAt = Date.now();
  }

  broadcast(io, room, 'game:move', {
    move, fen: room.chess.fen(), turn: room.chess.turn(),
    clocks: { w: room.clocks.w, b: room.clocks.b },
    check: room.chess.inCheck(),
    moves: room.moves,
    unlimited: room.time.unlimited,
  });

  persistRoom(room);
  checkGameOver(io, room);
  return { ok: true, move };
}

function colorFor(room, socketId) {
  for (const c of ['w', 'b']) {
    if (room.players[c] && room.players[c].socketId === socketId) return c;
  }
  return null;
}
const opp = (c) => (c === 'w' ? 'b' : 'w');

/* ------------------------- game over ------------------------- */
const TERMINATION = {
  checkmate: 'checkmate', stalemate: 'stalemate', insufficient: 'insufficient_material',
  threefold: 'threefold', fifty: 'fifty_move', flag: 'timeout', resign: 'resignation',
  agreement: 'agreement', abort: 'abort',
};

export function checkGameOver(io, room) {
  const c = room.chess;
  if (c.isCheckmate()) return endGame(io, room, opp(c.turn()), 'checkmate');
  if (c.isStalemate()) return endGame(io, room, null, 'stalemate');
  if (c.isInsufficientMaterial()) return endGame(io, room, null, 'insufficient_material');
  if (c.isThreefoldRepetition()) return endGame(io, room, null, 'threefold');
  if (c.isDraw()) return endGame(io, room, null, 'fifty_move');
  return false;
}

export function endGame(io, room, winnerColor, reason, initiator) {
  if (room.status === 'over') return;
  room.status = 'over';
  room.result = { winner: winnerColor, reason };
  const winner = winnerColor ? room.players[winnerColor] : null;
  const loser = winnerColor ? room.players[opp(winnerColor)] : null;

  const payload = {
    winner: winnerColor, reason, winnerName: winner?.name || null,
    loserName: loser?.name || null,
  };
  broadcast(io, room, 'game:over', payload);
  persistRoom(room);
  applyElo(room);
  return payload;
}

export function resign(io, room, socketId) {
  const color = colorFor(room, socketId);
  if (!color) return { ok: false, reason: 'not a player' };
  if (room.status !== 'playing') return { ok: false, reason: 'game not active' };
  endGame(io, room, opp(color), 'resignation', socketId);
  return { ok: true };
}

export function offerDraw(io, room, socketId) {
  const color = colorFor(room, socketId);
  if (!color || room.status !== 'playing') return { ok: false };
  room.drawOffer = true; room.drawBy = color;
  broadcast(io, room, 'game:drawOffer', { by: color });
  return { ok: true };
}
export function declineDraw(io, room) {
  room.drawOffer = false; room.drawBy = null;
  broadcast(io, room, 'game:drawDeclined', {});
  return { ok: true };
}
export function acceptDraw(io, room, socketId) {
  const color = colorFor(room, socketId);
  if (!color || !room.drawOffer) return { ok: false };
  // The opponent must have offered.
  if (room.drawBy === color) return { ok: false };
  endGame(io, room, null, 'agreement');
  return { ok: true };
}
export function agreeDraw(io, room, socketId) {
  // Any of the two players may agree to a draw.
  return acceptDrawSoft(io, room, socketId);
}
function acceptDrawSoft(io, room, socketId) {
  const color = colorFor(room, socketId);
  if (!color || room.status !== 'playing') return { ok: false };
  endGame(io, room, null, 'agreement');
  return { ok: true };
}

export function rematch(io, room, socketId) {
  const color = colorFor(room, socketId);
  if (!color) return { ok: false };
  if (room.status !== 'over') return { ok: false };
  if (!room.rematchVotes.includes(color)) room.rematchVotes.push(color);
  broadcast(io, room, 'game:rematchVote', { votes: [...room.rematchVotes] });
  if (room.rematchVotes.includes('w') && room.rematchVotes.includes('b')) {
    resetRoomForRematch(room);
    broadcast(io, room, 'game:reset', roomToPublic(room));
    const now = new Date().toISOString();
    db.updateGame(room.id, { status: 'playing', fen: room.chess.fen(), moves: [], turn_started_at: now, last_move: null }).catch(() => {});
  }
  return { ok: true };
}
function resetRoomForRematch(room) {
  room.chess = new Chess();
  room.moves = [];
  room.clocks = { w: room.time.baseMs, b: room.time.baseMs };
  room.timeStartedAt = room.time.unlimited ? null : Date.now();
  room.status = 'playing';
  room.result = null; room.drawOffer = false; room.drawBy = null;
  room.rematchVotes = [];
}

/* ------------------------- chat ------------------------- */
export function chat(io, room, socketId, text) {
  const color = colorFor(room, socketId);
  const name = color ? room.players[color].name : (room.spectators.get(socketId) || 'Spectator');
  const clean = String(text || '').slice(0, 300);
  if (!clean.trim()) return { ok: false };
  const msg = {
    id: socketId + Date.now(), name, color, text: clean,
    ts: new Date().toISOString(),
  };
  broadcast(io, room, 'game:chat', msg);
  db.addChat(room.id, color ? room.players[color].id : null, clean).catch(() => {});
  return { ok: true, msg };
}

/* ------------------------- persistence ------------------------- */
export async function persistRoom(room) {
  const data = {
    fen: room.chess.fen(),
    pgn: room.chess.pgn(),
    moves: room.moves,
    status: room.status,
    white_ms: room.clocks.w,
    black_ms: room.clocks.b,
    turn_started_at: room.timeStartedAt ? new Date(room.timeStartedAt).toISOString() : null,
    last_move: room.moves[room.moves.length - 1]?.last || null,
    winner: room.result?.winner || null,
    over_reason: room.result?.reason || null,
  };
  const updated = await db.updateGame(room.id, data).catch((e) => { console.error('persist failed', e.message); return null; });
  if (!updated) console.error(`persist: no row matched for game id ${room.id} (code ${room.code})`);
}

/* ------------------------- elo ------------------------- */
const K = 32;
function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
async function applyElo(room) {
  const w = room.players.w, b = room.players.b;
  if (!w || !b) return;
  const ra = w.rating, rb = b.rating;
  const scoreW = room.result?.winner === 'w' ? 1 : room.result?.winner === 'b' ? 0 : 0.5;
  const scoreB = 1 - scoreW;
  const dw = Math.round(K * (scoreW - expected(ra, rb)));
  const db_ = Math.round(K * (scoreB - expected(rb, ra)));
  await db.updateProfile(w.id, { elo: Math.max(100, ra + dw) }).catch(() => {});
  await db.updateProfile(b.id, { elo: Math.max(100, rb + db_) }).catch(() => {});
  await db.updateProfile(w.id, eloStatFields(w.id, scoreW)).catch(() => {});
  await db.updateProfile(b.id, eloStatFields(b.id, scoreB)).catch(() => {});
}
async function eloStatFields(userId, score) {
  const p = await db.getProfileByUserId(userId);
  if (!p) return {};
  return {
    games_played: (p.games_played || 0) + 1,
    wins: (p.wins || 0) + (score === 1 ? 1 : 0),
    losses: (p.losses || 0) + (score === 0 ? 1 : 0),
    draws: (p.draws || 0) + (score === 0.5 ? 1 : 0),
  };
}

/* ------------------------- lifecycle / cleanup ------------------------- */
export function removeRoom(id) { rooms.delete(id); }
export function getRoom(id) { return rooms.get(id); }
export function allRooms() { return rooms; }

// Clock model: `clocks` holds the remaining ms at the moment of the last move
// (`timeStartedAt`). The current remaining time is *computed* on each tick without
// mutating `clocks` (which would double-count elapsed time). Returns the rooms that
// must be flagged for timeout.
export function tick() {
  const flags = [];
  for (const room of rooms.values()) {
    if (room.status !== 'playing' || !room.timeStartedAt) continue;
    const turn = room.chess.turn();
    const elapsed = Date.now() - room.timeStartedAt;
    if (Math.max(0, room.clocks[turn] - elapsed) <= 0) {
      flags.push({ room, winner: opp(turn) });
    }
  }
  return flags;
}

// Computed remaining clock for both sides (for display), without mutating state.
export function clockState(room) {
  const turn = room.chess.turn();
  if (room.time.unlimited) return { turn, clocks: { w: null, b: null }, unlimited: true };
  if (!room.timeStartedAt) return { turn, clocks: { w: room.clocks.w, b: room.clocks.b }, unlimited: false };
  const elapsed = Date.now() - room.timeStartedAt;
  const w = turn === 'w' ? Math.max(0, room.clocks.w - elapsed) : room.clocks.w;
  const b = turn === 'b' ? Math.max(0, room.clocks.b - elapsed) : room.clocks.b;
  return { turn, clocks: { w, b }, unlimited: false };
}
export function roomPublic(room, player) { return roomToPublic(room, player); }
