// dbAdapter.js — persistence layer backed by Insforge Postgres.
// Uses the admin `rawsql` endpoint with parameterized queries (safe against SQL injection).
import { config } from './config.js';

// In-memory fallback store used when DB_MODE === 'memory' (local testing).
const mem = { profiles: new Map(), games: new Map(), chat: new Map(), friends: new Map() };
let memSeq = 1;
const uuid = () => {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (memSeq++ * 2654435761) & 0xffffffff; return null; // not used when crypto exists
  });
};

async function call(sql, params = []) {
  if (config.dbMode === 'memory') return memCall(sql, params);
  const base = config.insforgeBaseUrl.replace(/\/$/, '');
  const url = `${base}/api/database/advance/rawsql`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.insforgeApiKey}`,
      },
      body: JSON.stringify({ query: sql, params }),
    });
  } catch (err) {
    throw new Error(`Insforge unreachable: ${err.message}`);
  }
  let data;
  try { data = await res.json(); } catch { data = { raw: await res.text() }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`DB error (${res.status}): ${msg}`);
  }
  return data.rows || [];
}

/* ----------------------- in-memory fallback ----------------------- */
function memCall(sql, params) {
  // Extremely small subset used only when DB_MODE=memory. Not intended for production.
  const words = sql.trim().split(/\s+/);
  const verb = words[0].toUpperCase();
  const table = (words.find((w) => w === 'FROM' || w === 'INTO' || w === 'UPDATE' || w === 'INSERT') && words.indexOf(words.find((w)=>w==='UPDATE'||w==='FROM'||w==='INTO'))+1) || '';
  const t = table.toLowerCase();
  if (verb === 'SELECT' && sql.includes('FROM profiles')) return { rows: [...mem.profiles.values()] };
  if (verb === 'SELECT' && sql.includes('FROM games')) return { rows: [...mem.games.values()] };
  if (verb === 'SELECT') return { rows: [] };
  return { rows: [] };
}

/* ----------------------------- helpers ----------------------------- */
function jsonbParam(v) { return typeof v === 'string' ? v : JSON.stringify(v); }

const PK = (sql) => sql;

/* ----------------------------- auth -------------------------------- */
export async function getProfileByEmail(email) {
  const rows = await call('SELECT * FROM profiles WHERE email = $1 LIMIT 1;', [email]);
  return rows[0] || null;
}
export async function getProfileByUsername(username) {
  const rows = await call('SELECT * FROM profiles WHERE username = $1 LIMIT 1;', [username]);
  return rows[0] || null;
}
export async function getProfileByUserId(userId) {
  const rows = await call('SELECT * FROM profiles WHERE user_id = $1 LIMIT 1;', [userId]);
  return rows[0] || null;
}
export async function createProfile(p) {
  const rows = await call(
    `INSERT INTO profiles (user_id, email, username, display_name, avatar_url, password_hash, country, elo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1200) RETURNING *;`,
    [p.user_id, p.email, p.username, p.display_name, p.avatar_url || null, p.password_hash, p.country || null]
  );
  return rows[0];
}
export async function updateProfile(userId, fields) {
  const allowed = ['username', 'display_name', 'avatar_url', 'country', 'bio', 'role',
    'elo', 'wins', 'losses', 'draws', 'games_played'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getProfileByUserId(userId);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map((k) => fields[k]);
  const rows = await call(
    `UPDATE profiles SET ${sets}, updated_at = now() WHERE user_id = $1 RETURNING *;`,
    [userId, ...vals]
  );
  return rows[0];
}

/* ----------------------------- accounts ---------------------------- */
export async function listLeaderboard(limit = 25) {
  return call(
    `SELECT id, user_id, username, display_name, avatar_url, elo, wins, losses, draws, games_played
     FROM profiles ORDER BY elo DESC LIMIT $1;`,
    [limit]
  );
}

/* ----------------------------- friends ----------------------------- */
// Send a friend request. Auto-accepts if a reverse pending request exists (mutual).
export async function requestFriend(userId, friendUserId) {
  const reverse = await call(
    `SELECT id FROM friends WHERE user_id=$1 AND friend_id=$2 AND status='pending';`,
    [friendUserId, userId]
  );
  if (reverse.length) {
    await call(`DELETE FROM friends WHERE id=$1;`, [reverse[0].id]);
    await call(
      `INSERT INTO friends (user_id, friend_id, status) VALUES ($1,$2,'accepted')
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status='accepted', created_at=now();`,
      [userId, friendUserId]
    );
    return 'accepted';
  }
  const existing = await call(
    `SELECT id FROM friends WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1));`,
    [userId, friendUserId]
  );
  if (existing.length) return 'already';
  await call(
    `INSERT INTO friends (user_id, friend_id, status) VALUES ($1,$2,'pending')
     ON CONFLICT (user_id, friend_id) DO UPDATE SET status='pending', created_at=now();`,
    [userId, friendUserId]
  );
  return 'requested';
}

// Accepted friends (either direction), joined to their profile.
export async function listFriends(userId) {
  return call(
    `SELECT p.user_id AS friend_user_id, p.username, p.display_name, p.avatar_url, p.elo,
            p.wins, p.losses, p.draws, p.games_played, f.created_at as since
     FROM friends f JOIN profiles p ON p.user_id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END
     WHERE f.status='accepted' AND (f.user_id=$1 OR f.friend_id=$1) ORDER BY p.elo DESC;`,
    [userId]
  );
}

// Requests sent TO me (pending, where I'm the receiver).
export async function incomingRequests(userId) {
  return call(
    `SELECT f.id AS request_id, p.user_id, p.username, p.display_name, p.avatar_url, p.elo, f.created_at
     FROM friends f JOIN profiles p ON p.user_id = f.user_id
     WHERE f.friend_id=$1 AND f.status='pending' ORDER BY f.created_at DESC;`,
    [userId]
  );
}

// Requests I SENT (pending, where I'm the sender).
export async function outboundRequests(userId) {
  return call(
    `SELECT f.id AS request_id, p.user_id, p.username, p.display_name, p.avatar_url, p.elo, f.created_at
     FROM friends f JOIN profiles p ON p.user_id = f.friend_id
     WHERE f.user_id=$1 AND f.status='pending' ORDER BY f.created_at DESC;`,
    [userId]
  );
}

export async function acceptFriendRequest(userId, requestId) {
  const rows = await call(
    `UPDATE friends SET status='accepted', created_at=now()
     WHERE id=$1 AND friend_id=$2 AND status='pending' RETURNING id;`,
    [requestId, userId]
  );
  return rows.length > 0;
}

export async function declineFriendRequest(userId, requestId) {
  await call(`DELETE FROM friends WHERE id=$1 AND friend_id=$2 AND status='pending';`, [requestId, userId]);
}
export async function cancelFriendRequest(userId, requestId) {
  await call(`DELETE FROM friends WHERE id=$1 AND user_id=$2 AND status='pending';`, [requestId, userId]);
}
export async function removeFriend(userId, otherUserId) {
  await call(
    `DELETE FROM friends WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1));`,
    [userId, otherUserId]
  );
}

/* ----------------------------- ranking ----------------------------- */
export async function rankPosition(userId) {
  const rows = await call(
    `SELECT COUNT(*)::int + 1 AS pos FROM profiles
     WHERE elo > (SELECT elo FROM profiles WHERE user_id=$1);`,
    [userId]
  );
  const pos = rows[0]?.pos;
  return typeof pos === 'number' ? pos : null;
}
export async function totalProfiles() {
  const rows = await call(`SELECT COUNT(*)::int AS n FROM profiles;`);
  return rows[0]?.n ?? 0;
}

/* ----------------------------- games ------------------------------- */
export async function createGame(g) {
  const rows = await call(
    `INSERT INTO games (id, code, host_id, guest_id, host_color, fen, pgn, moves, status,
       time_base, increment, white_ms, black_ms, turn_started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) RETURNING *;`,
    [g.id, g.code, g.host_id || null, g.guest_id || null, g.host_color, g.fen, g.pgn || '', jsonbParam(g.moves || []),
      g.status || 'open', g.time_base, g.increment, g.white_ms, g.black_ms, g.turn_started_at || null]
  );
  return rows[0];
}
export async function updateGame(id, fields) {
  const allowed = ['guest_id', 'host_color', 'fen', 'pgn', 'moves', 'status', 'white_ms', 'black_ms',
    'last_move', 'winner', 'over_reason', 'turn_started_at', 'host_id', 'code'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getGame(id);
  const sets = keys.map((k, i) => {
    if (k === 'moves' || k === 'last_move') return `${k} = $${i + 2}::jsonb`;
    return `${k} = $${i + 2}`;
  }).join(', ');
  const vals = keys.map((k) => (k === 'moves' || k === 'last_move' ? jsonbParam(fields[k]) : fields[k]));
  const rows = await call(
    `UPDATE games SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *;`,
    [id, ...vals]
  );
  return rows[0];
}
export async function getGame(id) {
  const rows = await call('SELECT * FROM games WHERE id = $1 LIMIT 1;', [id]);
  return rows[0] || null;
}
export async function getGameByCode(code) {
  const rows = await call('SELECT * FROM games WHERE code = $1 LIMIT 1;', [code]);
  return rows[0] || null;
}
export async function listOpenGames() {
  return call(
    `SELECT id, code, host_color, time_base, increment, status, host_id, created_at
     FROM games WHERE status = 'open' ORDER BY created_at DESC LIMIT 40;`
  );
}
export async function recentGamesForUser(userId, limit = 20) {
  return call(
    `SELECT * FROM games WHERE host_id = $1 OR guest_id = $1
     ORDER BY updated_at DESC LIMIT $2;`,
    [userId, limit]
  );
}

/* ----------------------------- chat -------------------------------- */
export async function addChat(gameId, userId, text) {
  const rows = await call(
    `INSERT INTO game_chat (game_id, user_id, text) VALUES ($1,$2,$3) RETURNING *;`,
    [gameId, userId, text]
  );
  return rows[0];
}
export async function getChats(gameId, limit = 50) {
  return call(
    `SELECT * FROM game_chat WHERE game_id = $1 ORDER BY created_at DESC LIMIT $2;`,
    [gameId, limit]
  );
}

export default {
  call, getProfileByEmail, getProfileByUsername, getProfileByUserId, createProfile, updateProfile,
  listLeaderboard, requestFriend, listFriends, incomingRequests, outboundRequests,
  acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend,
  rankPosition, totalProfiles,
  createGame, updateGame, getGame, getGameByCode,
  listOpenGames, recentGamesForUser, addChat, getChats,
};
