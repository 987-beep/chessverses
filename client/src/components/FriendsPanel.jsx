import { useEffect, useState } from 'react';
import { tierForElo, gradeLabel } from '../rank.js';

export default function FriendsPanel({ token, socket, onInvite, onToast }) {
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timeCtl, setTimeCtl] = useState({ tb: 5, inc: 0 });

  async function refresh() {
    setLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [f, req] = await Promise.all([
        fetch('/api/friends', { headers: h }).then((r) => r.json()),
        fetch('/api/friends/requests', { headers: h }).then((r) => r.json()),
      ]);
      setFriends(f.friends || []);
      setIncoming(req.incoming || []);
      setOutbound(req.outbound || []);
      setLoading(false);
    } catch { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function addFriend() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: query.trim() }),
      });
      const d = await res.json();
      if (!res.ok) onToast && onToast(d.error || 'Could not send request', 'err');
      else onToast && onToast('Friend request sent');
      refresh();
    } catch { onToast && onToast('Network error', 'err'); }
    setBusy(false); setQuery('');
  }

  async function post(path, body) {
    await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    refresh();
  }

  function challenge(friend) {
    // Send a realtime invite to the friend; they get a popup to accept.
    socket.emit('friend:invite', { to: friend.friend_user_id, time_base: timeCtl.tb * 60, increment: timeCtl.inc }, (r) => {
      if (r && r.ok) onToast && onToast(`Challenge sent to ${friend.username || friend.display_name}`);
      else onToast && onToast((r && r.reason) || 'Friend is offline', 'err');
    });
  }

  return (
    <div className="lobby-cols">
      <div className="card">
        <h3>Friends</h3>
        <div className="join-strip" style={{ marginBottom: 14 }}>
          <input className="input" placeholder="Add by username…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFriend()} />
          <button className="btn primary" onClick={addFriend} disabled={busy || !query.trim()}>+ Add</button>
        </div>

        <div className="row-help">Set the time control for challenges, then press “Play” on a friend.</div>
        <div className="time-buttons" style={{ marginBottom: 14 }}>
          {[{ b: 0, n: '∞' }, { b: 3, n: '3m' }, { b: 5, n: '5m' }, { b: 10, n: '10m' }, { b: 30, n: '30m' }].map((t) => (
            <button key={t.b} className={`time-btn ${timeCtl.tb === t.b ? 'active' : ''}`}
              onClick={() => setTimeCtl({ tb: t.b, inc: t.b === 0 ? 0 : timeCtl.inc })}>
              <b>{t.b === 0 ? '∞' : t.n}</b>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="spinner" style={{ margin: '12px auto' }} />
        ) : friends.length === 0 ? (
          <p className="muted">No friends yet. Add a friend by username above.</p>
        ) : (
          <div className="list">
            {friends.map((f) => {
              const tier = tierForElo(f.elo);
              return (
                <div className="row-item" key={f.friend_user_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: f.online ? 'var(--ok)' : '#666', flex: 'none' }} />
                    <div className="l">
                      <span className="t">{f.display_name || f.username}</span>
                      <span className="d" style={{ color: tier.color }}>
                        {gradeLabel(tier)} · {f.elo} · {f.wins}/{f.losses}/{f.draws}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small green" disabled={!f.online} onClick={() => challenge(f)}>Play</button>
                    <button className="btn small ghost" onClick={async () => { await fetch(`/api/friends/${f.friend_user_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); refresh(); }}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card">
          <h3>Requests received</h3>
          {incoming.length === 0 ? <p className="muted">No pending requests.</p> : (
            <div className="list">
              {incoming.map((r) => (
                <div className="row-item" key={r.request_id}>
                  <div className="l">
                    <span className="t">{r.display_name || r.username}</span>
                    <span className="d">Rating {r.elo}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small green" onClick={() => post('/api/friends/accept', { requestId: r.request_id })}>Accept</button>
                    <button className="btn small ghost" onClick={() => post('/api/friends/decline', { requestId: r.request_id })}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3>Requests sent</h3>
          {outbound.length === 0 ? <p className="muted">No outgoing requests.</p> : (
            <div className="list">
              {outbound.map((r) => (
                <div className="row-item" key={r.request_id}>
                  <div className="l"><span className="t">{r.display_name || r.username}</span><span className="d">Pending</span></div>
                  <button className="btn small ghost" onClick={() => post('/api/friends/cancel', { requestId: r.request_id })}>Cancel</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
