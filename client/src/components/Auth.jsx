import { useState } from 'react';
import { api } from '../config.js';

export default function Auth({ onAuthed, onGuest }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await fetch(api('/auth/' + (mode === 'login' ? 'login' : 'register')), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username, display_name: name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Something went wrong'); return; }
      localStorage.setItem('cv_token', data.token);
      onAuthed({
        id: data.user.id, username: data.user.username, name: data.user.name,
        rating: data.user.rating, email: data.user.email, guest: false, token: data.token,
      });
    } catch (ex) { setErr('Network error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 16 }}>
          <span className="logo">♞</span>
          <span><b>Chess</b>Verse</span>
        </div>
        <div className="auth-tabs">
          <button className={`btn ${mode === 'login' ? 'primary' : 'ghost'}`} onClick={() => setMode('login')}>Log in</button>
          <button className={`btn ${mode === 'register' ? 'primary' : 'ghost'}`} onClick={() => setMode('register')}>Sign up</button>
        </div>
        <form onSubmit={submit}>
          <label className="field"><span>Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {mode === 'register' && (
            <>
              <label className="field"><span>Username</span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="display name" />
              </label>
            </>
          )}
          <label className="field"><span>Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
          <button className="btn primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
            {busy ? 'Please wait…' : (mode === 'login' ? 'Log in' : 'Create account')}
          </button>
        </form>
        <div style={{ textAlign: 'center', margin: '14px 0' }}>
          <span className="muted">or</span>
        </div>
        <button className="btn green" style={{ width: '100%' }} onClick={() => onGuest()}>
          Play as Guest
        </button>
        <p className="caption" style={{ textAlign: 'center' }}>Guests can play immediately — accounts unlock ratings, history &amp; friends.</p>
      </div>
    </div>
  );
}
