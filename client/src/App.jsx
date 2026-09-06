import { useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';
import { tierForElo } from './rank.js';
import Auth from './components/Auth.jsx';
import Lobby from './components/Lobby.jsx';
import FriendsPanel from './components/FriendsPanel.jsx';
import RankingPanel from './components/RankingPanel.jsx';
import ProfilePanel from './components/ProfilePanel.jsx';
import GameScreen from './components/GameScreen.jsx';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('cv_token') || null);
  const [view, setView] = useState('start'); // start | home | game
  const [homeTab, setHomeTab] = useState('play'); // play | friends | ranking | profile
  const [game, setGame] = useState(null);
  const [chat, setChat] = useState([]);
  const [lobby, setLobby] = useState({ games: [], leaderboard: [] });
  const [queuedKey, setQueuedKey] = useState(null);
  const [invite, setInvite] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  function showToast(text, kind = 'info') {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const onAuthed = (u) => {
    setUser(u); setToken(u.token || localStorage.getItem('cv_token'));
    setView('home'); setHomeTab('play');
    socket.emit('auth', { token: u.token || localStorage.getItem('cv_token') });
    socket.emit('lobby:join');
  };

  const makeUuid = () => {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
    });
  };

  const onGuest = () => {
    let gid = localStorage.getItem('cv_guest');
    if (!gid) { gid = makeUuid(); localStorage.setItem('cv_guest', gid); }
    socket.emit('auth', { guest: true, guestId: gid, name: 'Guest' }, (r) => {
      if (r && r.ok) {
        setUser(r.user); setToken(null);
        setView('home'); setHomeTab('play');
        socket.emit('lobby:join');
      }
    });
  };

  // ---- socket listeners (once) ----
  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('lobby:state', (s) => setLobby({ games: s.games || [], leaderboard: s.leaderboard || [] }));
    socket.on('queue:status', (p) => setQueuedKey(p.queued ? p.key : null));

    socket.on('game:joined', (p) => {
      setQueuedKey(null); setInvite(null);
      setGame({ ...p.game, youAre: p.youAre || null, spectating: !!p.spectating });
      setChat([]);
      setView('game');
    });

    socket.on('game:move', (p) => {
      setGame((g) => g ? {
        ...g, fen: p.fen, turn: p.turn, clocks: p.clocks, moves: p.moves,
        lastMove: p.move?.last || null, check: p.check,
      } : g);
    });

    socket.on('game:clock', (p) => {
      setGame((g) => g ? { ...g, clocks: p.clocks, turn: p.turn } : g);
    });

    socket.on('game:over', (p) => {
      setGame((g) => g ? {
        ...g, status: 'over', result: { winner: p.winner, reason: p.reason },
        winnerName: p.winnerName, loserName: p.loserName,
      } : g);
    });

    socket.on('game:chat', (m) => setChat((c) => [...c, m]));
    socket.on('game:drawOffer', (p) => showToast(`${p.by === 'w' ? 'White' : 'Black'} offers a draw`));
    socket.on('game:drawDeclined', () => showToast('Draw declined'));
    socket.on('game:rematchVote', (p) => setGame((g) => g ? { ...g, rematchVotes: p.votes } : g));
    socket.on('game:reset', (g) => { setGame({ ...g, youAre: g.youAre || null }); setChat([]); });
    socket.on('game:presence', (p) => {
      setGame((g) => g ? { ...g, [p.color]: { ...g[p.color], connected: p.connected } } : g);
    });

    socket.on('friend:invite', (p) => setInvite(p));
    socket.on('friend:inviteAccepted', () => showToast('Invitation accepted'));

    socket.on('error', (msg) => showToast(msg || 'Socket error', 'err'));

    return () => { socket.off(); };
  }, []);

  // ---- auto-login on mount ----
  useEffect(() => {
    const t = localStorage.getItem('cv_token');
    if (!t) return;
    socket.emit('auth', { token: t }, (r) => {
      if (r && r.ok) { setUser(r.user); setView('home'); socket.emit('lobby:join'); }
      else { localStorage.removeItem('cv_token'); setToken(null); }
    });
  }, []);

  function logout() {
    localStorage.removeItem('cv_token');
    socket.emit('lobby:leave');
    setUser(null); setGame(null); setView('start'); setQueuedKey(null); setToken(null); setInvite(null);
  }

  function goHome() { setGame(null); setView('home'); setHomeTab('play'); socket.emit('lobby:join'); }

  if (!connected) {
    return (
      <div className="connecting">
        <div className="spinner" />
        <div>Connecting to ChessVerse…</div>
      </div>
    );
  }

  if (view === 'start' || !user) {
    return <Auth onAuthed={onAuthed} onGuest={onGuest} />;
  }

  const tier = tierForElo(user.rating);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">♞</span>
          <span><b>Chess</b>Verse</span>
        </div>
        <div className="right">
          {view === 'game' && (
            <button className="btn ghost small" onClick={goHome}>Back to Lobby</button>
          )}
          <div className="userchip">
            <div className="av">{user.name.charAt(0).toUpperCase()}</div>
            <div>
              <div className="nm" style={{ color: tier.color }}>{user.name}</div>
              <div className="sub">{user.guest ? 'Guest' : `${tier.name} · ${user.rating}`}</div>
            </div>
          </div>
          <button className="btn ghost small" onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="main">
        {view === 'home' && (
          <>
            <div className="subnav">
              {[['play', 'Play'], ['friends', 'Friends'], ['ranking', 'Ranking'], ['profile', 'Profile']].map(([k, label]) => (
                <button key={k} className={`btn ${homeTab === k ? 'primary' : 'ghost'}`} onClick={() => setHomeTab(k)}>{label}</button>
              ))}
            </div>
            <div style={{ width: '100%' }}>
              {homeTab === 'play' && (
                <Lobby user={user} socket={socket} lobby={lobby} queuedKey={queuedKey} />
              )}
              {homeTab === 'friends' && (
                <FriendsPanel token={token} socket={socket} onToast={showToast} onInvite={(u) => {}} />
              )}
              {homeTab === 'ranking' && (
                <RankingPanel token={token} me={user} />
              )}
              {homeTab === 'profile' && (
                <ProfilePanel token={token} me={user} onToast={showToast} />
              )}
            </div>
          </>
        )}

        {view === 'game' && game && (
          <GameScreen game={game} chat={chat} socket={socket} onToast={showToast} />
        )}
        {view === 'game' && !game && (
          <div className="card center-flex" style={{ width: '100%', alignItems: 'center', padding: 40 }}>
            <div className="spinner" />
            <div className="muted">Loading game…</div>
          </div>
        )}
      </main>

      {invite && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Game invite</h2>
            <p><b>{invite.from?.name}</b> wants to play you<br />
              <span className="tag">{invite.unlimited ? '∞ Untimed' : `${invite.time_base / 60} min + ${invite.increment}s`}</span>
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn green" onClick={() => { socket.emit('friend:inviteAccept', { inviteId: invite.inviteId }); setInvite(null); }}>Accept</button>
              <button className="btn ghost" onClick={() => { socket.emit('friend:inviteDecline', { inviteId: invite.inviteId }); setInvite(null); }}>Decline</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}
