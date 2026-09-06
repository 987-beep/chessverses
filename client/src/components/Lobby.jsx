import { useState } from 'react';

const TC = [
  { b: 0, i: 0, n: 'Untimed' },
  { b: 1, i: 0, n: 'Bullet' },
  { b: 3, i: 0, n: 'Blitz' },
  { b: 3, i: 2, n: 'Blitz' },
  { b: 5, i: 0, n: 'Rapid' },
  { b: 10, i: 0, n: 'Rapid' },
  { b: 15, i: 10, n: 'Rapid' },
];
const fmt = (t) => (t.b === 0 ? '∞' : t.i ? `${t.b}+${t.i}` : `${t.b} min`);

export default function Lobby({ user, socket, lobby, queuedKey, onPlay, onJoin, onLogout }) {
  const [tab, setTab] = useState('play');
  const [code, setCode] = useState('');
  const [tb, setTb] = useState(3);
  const [inc, setInc] = useState(0);
  const [untimed, setUntimed] = useState(false);
  const [joinMode, setJoinMode] = useState('join');
  const [qm, setQm] = useState(3);
  const [qInc, setQInc] = useState(0);
  const [busy, setBusy] = useState(false);

  const record = (w, l, d) => `${w} / ${l} / ${d}`;

  async function doQuickMatch() {
    setBusy(true);
    socket.emit('queue:join', { time_base: qm * 60, increment: qInc }, (r) => { if (r && !r.ok) {} });
    setBusy(false);
  }

  async function createGame() {
    const color = Math.random() < 0.5 ? 'w' : 'b';
    socket.emit('game:create', { time_base: tb * 60, increment: inc, host_color: color }, () => {});
  }

  function joinByCode() {
    if (!code.trim()) return;
    socket.emit('game:join', { code: code.trim() }, () => {});
  }

  return (
    <div className="lobby-grid">
      <div className="lobby-cols">
        <div className="card">
          <h3>Play Chess</h3>
          <div className="auth-tabs">
            <button className={`btn ${tab === 'play' ? 'primary' : 'ghost'}`} onClick={() => setTab('play')}>Play</button>
            <button className={`btn ${tab === 'room' ? 'primary' : 'ghost'}`} onClick={() => setTab('room')}>
              {joinMode === 'join' ? 'Join' : 'Create'}
            </button>
          </div>

          {tab === 'play' && (
            <>
              <div className="row-help">Find an opponent online. You get paired instantly.</div>
              <div className="time-buttons">
                {TC.map((t) => (
                  <button key={`${t.b}-${t.i}`} className={`time-btn ${qm === t.b && qInc === t.i ? 'active' : ''}`}
                    onClick={() => { setQm(t.b); setQInc(t.i); }}>
                    <b>{fmt(t)}</b>
                    <span>{t.n}</span>
                  </button>
                ))}
              </div>
              <button className="btn primary" style={{ width: '100%' }} disabled={!!queuedKey} onClick={doQuickMatch}>
                {queuedKey ? 'Searching for opponent…' : 'Play vs Player'}
              </button>
            </>
          )}

          {tab === 'room' && (
            <>
              {joinMode === 'join' ? (
                <>
                  <div className="row-help">Enter a 6-character room code a friend shared with you.</div>
                  <div className="join-strip">
                    <input className="input" placeholder="Room code e.g. AB12CD" maxLength={6}
                      value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && joinByCode()} />
                    <button className="btn primary" onClick={joinByCode} disabled={!code.trim() || !!queuedKey}>Join</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="row-help">Set a custom time control and create a private room to share. Turn on “No time limit” for a relaxed, untimed game.</div>
                  <button
                    className={`time-btn ${untimed ? 'active' : ''}`}
                    style={{ width: '100%', marginBottom: 12 }}
                    onClick={() => {
                      if (!untimed) { setUntimed(true); setTb(0); setInc(0); }
                      else { setUntimed(false); setTb(3); }
                    }}
                  >
                    <b>∞</b><span>No time limit</span>
                  </button>
                  <div className="ctrl-grid">
                    <label className="field"><span>Base (minutes)</span>
                      <input className="input" type="number" min={0} value={tb} disabled={untimed} onChange={(e) => setTb(+e.target.value)} /></label>
                    <label className="field"><span>Increment (sec)</span>
                      <input className="input" type="number" min={0} value={inc} disabled={untimed} onChange={(e) => setInc(+e.target.value)} /></label>
                  </div>
                  <button className="btn green" style={{ width: '100%' }} onClick={createGame}>{untimed ? 'Create Untimed Room' : 'Create Room'}</button>
                </>
              )}
            </>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn ghost small" onClick={() => setJoinMode(joinMode === 'join' ? 'create' : 'join')}>
              → Switch to {joinMode === 'join' ? 'Create Room' : 'Join Room'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Open Games</h3>
          {lobby.games.length === 0 ? (
            <p className="muted">No open games right now — create one!</p>
          ) : (
            <div className="list">
              {lobby.games.map((g) => (
                <div className="row-item" key={g.id}>
                  <div className="l">
                    <span className="t">{g.code}</span>
                    <span className="d">{g.time_base / 60}+{g.increment} • {g.host_color === 'w' ? 'White' : 'Black'}</span>
                  </div>
                  <button className="btn small blue" onClick={() => socket.emit('game:join', { code: g.code }, () => {})}>Join</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Leaderboard</h3>
        <div className="list">
          {lobby.leaderboard.slice(0, 10).map((p, i) => (
            <div className="row-item" key={p.id || p.user_id}>
              <div className="l">
                <span className="t">{i + 1}. {p.display_name || p.username}</span>
                <span className="d">W/L/D {record(p.wins || 0, p.losses || 0, p.draws || 0)}</span>
              </div>
              <b style={{ color: 'var(--primary-2)' }}>{p.elo}</b>
            </div>
          ))}
          {lobby.leaderboard.length === 0 && <p className="muted">No rated players yet.</p>}
        </div>
      </div>
    </div>
  );
}
