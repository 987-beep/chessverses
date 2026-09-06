import { useEffect, useState } from 'react';
import { tierForElo, TIERS } from '../rank.js';
import { api } from '../config.js';

export default function RankingPanel({ token, me }) {
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myPos, setMyPos] = useState(null);
  const [total, setTotal] = useState(null);
  const [gradeConfirmed, setGradeConfirmed] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const b = await fetch(api('/leaderboard')).then((r) => r.json());
      setBoard(b);
      if (me && !me.guest) {
        // my profile endpoint gives rank position + grade
        const p = await fetch(api(`/profile/${me.username}`), { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        if (p.profile) {
          setMyPos(p.rank?.position);
          setTotal(p.rank?.total);
          setGradeConfirmed(p.profile.grade);
        }
      }
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const myTier = me && !me.guest ? tierForElo(me.rating) : tierForElo(me.rating || 1000);

  // next tier to reach for a nice progress indicator
  const nextTier = TIERS.find((t) => (me?.rating || 0) < t.min);
  const prevTier = [...TIERS].reverse().find((t) => (me?.rating || 0) >= t.min);
  const lowerBound = prevTier ? prevTier.min : 0;
  const upperBound = nextTier ? nextTier.min : (prevTier ? prevTier.min + 400 : 1200);
  const pct = nextTier ? Math.min(100, Math.round(((me?.rating || 0) - lowerBound) / (upperBound - lowerBound) * 100)) : 100;

  return (
    <div className="lobby-cols">
      <div className="card">
        <h3>Leaderboard</h3>
        <button className="btn ghost small" style={{ marginBottom: 12 }} onClick={load}>↻ Refresh</button>
        {loading ? <div className="spinner" style={{ margin: '12px auto' }} /> : board.length === 0 ? (
          <p className="muted">No rated players yet. Play a game to enter the ladder!</p>
        ) : (
          <div className="list">
            {board.map((p, i) => {
              const tier = tierForElo(p.elo);
              const isMe = me && me.username === p.username;
              return (
                <div className="row-item" key={p.id || p.user_id} style={isMe ? { borderColor: 'var(--primary-2)' } : {}}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    <b style={{ width: 22, textAlign: 'center', color: i < 3 ? 'var(--accent)' : 'var(--muted)' }}>{i + 1}</b>
                    <div className="l">
                      <span className="t">{p.display_name || p.username}{isMe ? ' (you)' : ''}</span>
                      <span className="d" style={{ color: tier.color }}>{tier.name}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>{p.elo}</b>
                    <div className="d">{p.wins || 0}/{p.losses || 0}/{p.draws || 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h3>My rating</h3>
        <div style={{ textAlign: 'center' }}>
          <div className="nm" style={{ fontSize: 34, fontWeight: 800 }}>{me?.rating ?? '—'}</div>
          <div style={{ color: myTier.color, fontWeight: 700 }}>{myTier.name}</div>
          {me?.guest && <p className="muted">Guests aren't rated — create an account to appear on the ladder.</p>}
        </div>
        {!me?.guest && (
          <>
            <div className="row-help mt">
              {nextTier
                ? <>You need <b>{upperBound - (me?.rating || 0)}</b> more points to reach <b style={{ color: nextTier.color }}>{nextTier.name}</b>.</>
                : <>You're at the top tier already. 🏆</>}
            </div>
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, height: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: nextTier ? nextTier.color : 'var(--primary-2)' }} />
            </div>
            {myPos != null && <p className="caption" style={{ textAlign: 'center', marginTop: 8 }}>Rank <b>#{myPos}</b> of {total ?? '—'} players</p>}
          </>
        )}
      </div>
    </div>
  );
}
