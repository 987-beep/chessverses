import { useEffect, useState } from 'react';
import { tierForElo } from '../rank.js';

export default function ProfilePanel({ token, me, onToast }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const p = await fetch(`/api/profile/${me.username}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        if (p.rank) { setPos(p.rank.position); setTotal(p.rank.total); }
        const g = await fetch(`/api/profile/${me.username}/games`).then((r) => r.json());
        setGames(g.games || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const tier = tierForElo(me.rating);
  const totalGames = (me.wins ?? 0) + (me.losses ?? 0) + (me.draws ?? 0);
  const winrate = totalGames ? Math.round(((me.wins ?? 0) / totalGames) * 100) : 0;

  function outcome(g) {
    // g.host_id / g.guest_id vs me => determine result
    let mySide = null;
    if (g.host_id === me.id) mySide = g.host_color; else if (g.guest_id === me.id) mySide = (g.host_color === 'w' ? 'b' : 'w');
    if (g.status !== 'over') return { cls: '', label: g.status };
    if (!g.winner) return { cls: 'draw', label: 'Draw' };
    const iWon = g.winner === mySide;
    return iWon ? { cls: 'win', label: 'Win' } : { cls: 'loss', label: 'Loss' };
  }

  return (
    <div className="lobby-cols">
      <div className="card">
        <h3>My profile</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div className="av" style={{ width: 64, height: 64, fontSize: 26, background: 'var(--primary-2)' }}>{me.name.charAt(0).toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{me.name}</div>
            <div style={{ color: tier.color, fontWeight: 700 }}>{tier.name}</div>
            <div className="muted">@{me.username}{me.guest ? ' · Guest account' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Stat label="Rating" value={me.rating} />
          <Stat label="Wins" value={me.wins ?? 0} />
          <Stat label="Draws" value={me.draws ?? 0} />
          <Stat label="Losses" value={me.losses ?? 0} />
        </div>
        {pos != null && <p className="caption">Ladder position: <b>#{pos}</b> of {total ?? '—'}</p>}
        {totalGames > 0 && <div className="row-help">Win rate: <b>{winrate}%</b></div>}
        {me.guest && <p className="muted">Create an account to keep your stats, rating, and ladder position.</p>}
      </div>

      <div className="card">
        <h3>Recent games</h3>
        {loading ? <div className="spinner" style={{ margin: '12px auto' }} /> : games.length === 0 ? (
          <p className="muted">No completed games yet.</p>
        ) : (
          <div className="list">
            {games.map((g) => {
              const o = outcome(g);
              const opp = g.host_id === me.id ? (g.guest_id ? 'Opponent' : '—') : 'Opponent';
              return (
                <div className="row-item" key={g.id}>
                  <div className="l">
                    <span className="t">{opp}</span>
                    <span className="d">{g.time_base / 60}+{g.increment} · {g.code}</span>
                  </div>
                  <span className={`tag ${o.cls}`}>{o.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}
