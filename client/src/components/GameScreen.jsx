import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import ChessboardView from './ChessboardView.jsx';

function fmtClock(ms) {
  if (ms == null) return '∞';
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(1, '0');
  const ss = s.toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function GameScreen({ game, chat, socket, onToast }) {
  const myColor = game.youAre;
  const status = game.status;
  const [boardFen, setBoardFen] = useState(game.fen);
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [showHints, setShowHints] = useState(true);
  const [lastMove, setLastMove] = useState(game.lastMove);
  const [votes, setVotes] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatRef = useRef(null);
  const prevFenRef = useRef(game.fen);

  // authoritative reconcile
  useEffect(() => {
    if (game.fen) { prevFenRef.current = game.fen; setBoardFen(game.fen); }
    setLastMove(game.lastMove);
    // When the authoritative position changes (opponent moved or game over),
    // clear any local selection/hint state.
    setSelected(null); setLegalMoves([]);
  }, [game.fen, game.lastMove, game.id]);

  // scroll chat
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chat.length]);
  useEffect(() => { setVotes(game.rematchVotes || []); }, [game.rematchVotes]);
  useEffect(() => { if (game.status === 'over') setSelected(null); }, [game.status]);

  const canMove = status === 'playing' && myColor === game.turn && !!myColor;
  const isWhiteView = myColor === null ? true : myColor === 'w';

  function predictFen(from, to, promotion) {
    try {
      const c = new Chess(prevFenRef.current);
      c.move({ from, to, promotion });
      return c.fen();
    } catch { return null; }
  }

  // Compute the legal moves for a square from the current (displayed) position.
  // Used for the "show hints" move-highlighting.
  function legalMovesFor(square) {
    try {
      const c = new Chess(prevFenRef.current);
      return c.moves({ square, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured, san: m.san }));
    } catch { return []; }
  }

  function handleMove(from, to, promotion) {
    if (!canMove) return;
    const pred = predictFen(from, to, promotion);
    if (pred) { prevFenRef.current = pred; setBoardFen(pred); }
    socket.emit('game:move', { from, to, promotion }, (r) => {
      if (r && !r.ok) {
        // illegal — revert to the last authoritative position
        prevFenRef.current = game.fen;
        setBoardFen(game.fen);
        onToast && onToast(r.reason || 'Illegal move', 'err');
      }
    });
    setSelected(null);
    setLegalMoves([]);
  }

  function handlePromotion(piece, from, to) {
    if (!canMove) return;
    // piece is like 'q','r','b','n'
    handleMove(from, to, piece);
  }

  function handleSelect(square) {
    if (!canMove) return;
    // If we already have a selected piece and click one of its legal targets, move there.
    if (selected) {
      const target = legalMoves.find((m) => m.to === square);
      if (target) { handleMove(selected, square, undefined); return; }
    }
    // Toggle selection off if clicking the same square.
    if (selected === square) { setSelected(null); setLegalMoves([]); return; }
    setSelected(square);
    setLegalMoves(showHints ? legalMovesFor(square) : []);
  }

  function toggleHints() {
    const next = !showHints;
    setShowHints(next);
    // Update the highlighted moves for the current selection.
    if (selected) setLegalMoves(next ? legalMovesFor(selected) : []);
    else setLegalMoves([]);
  }

  const opponentColor = myColor === null ? null : (myColor === 'w' ? 'b' : 'w');
  const bottom = myColor === null ? 'w' : myColor;
  const top = opponentColor || 'b';

  const you = myColor ? game[myColor === 'w' ? 'white' : 'black'] : null;
  const opp = top && game[top === 'w' ? 'white' : 'black'] ? game[top === 'w' ? 'white' : 'black'] : null;
  const oppName = opp?.name || (opp && (opp.name)) || 'Waiting…';

  const pairs = useMemo(() => {
    const out = [];
    for (let i = 0; i < game.moves.length; i += 2) {
      out.push({ n: i / 2 + 1, w: game.moves[i]?.san, b: game.moves[i + 1]?.san });
    }
    return out;
  }, [game.moves]);

  const resultText = useMemo(() => {
    if (status !== 'over' || !game.result) return '';
    const r = game.result;
    if (r.winner) {
      const wName = r.winner === 'w' ? game.white?.name : game.black?.name;
      return `${wName || (r.winner === 'w' ? 'White' : 'Black')} won by ${reasonLabel(r.reason)}`;
    }
    return `Draw — ${reasonLabel(r.reason)}`;
  }, [status, game.result, game.white, game.black]);

  return (
    <div className="game-grid">
      <div className="board-col">
        {status === 'over' && game.result && <GameOverBanner game={game} resultText={resultText} socket={socket} />}
        <PlayerBar player={top === 'w' ? game.white : game.black} clock={game.clocks?.[top]} active={status === 'playing' && game.turn === top} you={myColor === top} />
        <ChessboardView
          fen={boardFen}
          orientation={isWhiteView ? 'white' : 'black'}
          canMove={canMove}
          interactive={!!myColor}
          lastMove={lastMove}
          selected={selected}
          legalMoves={legalMoves}
          onMove={handleMove}
          onPromotion={handlePromotion}
          onSelectSquare={handleSelect}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', maxWidth: 560, justifyContent: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showHints} onChange={toggleHints} />
            Show hints (click a piece to see its moves)
          </label>
        </div>
        <PlayerBar player={bottom === 'w' ? game.white : game.black} clock={game.clocks?.[bottom]} active={status === 'playing' && game.turn === bottom} you={myColor === bottom} />
        <Controls game={game} socket={socket} disabled={!myColor} />
      </div>

      <div className="side-col">
        <div className="card">
          <h3>Moves</h3>
          <div className="move-list">
            {pairs.length === 0 ? (
              <div style={{ padding: 12 }} className="muted">No moves yet.</div>
            ) : (
              <table>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={p.n}>
                      <td className="mv">{p.n}.</td>
                      <td>{p.w}</td>
                      <td>{p.b || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="caption">
            {game.time?.unlimited ? 'Untimed game' : `${(game.time?.baseSec ?? 0) ? (game.time.baseSec / 60) + ' min' : ''}`}
            {game.time?.incSec ? ` +${game.time.incSec}s` : ''}
            {' • '}
            {status === 'playing' ? `${game.turn === 'w' ? 'White' : 'Black'} to move` : 'Game over'}
            {status === 'playing' && game.check ? ' • Check!' : ''}
          </p>
        </div>

        <div className="card">
          <h3>Chat</h3>
          <div className="chat">
            <div className="msgs" ref={chatRef}>
              {chat.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No messages.</span>}
              {chat.map((m) => (
                <div className={`m ${m.color && myColor === m.color ? 'mine' : ''}`} key={m.id}>
                  <b>{m.name}:</b> {m.text} <span className="time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
            <div className="in">
              <input className="input" placeholder="Type a message…" value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && chatInput.trim()) { socket.emit('game:chat', { text: chatInput.trim() }); setChatInput(''); } }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function reasonLabel(r) {
  switch (r) {
    case 'checkmate': return 'checkmate';
    case 'timeout': return 'timeout';
    case 'resignation': return 'resignation';
    case 'agreement': return 'agreement';
    case 'stalemate': return 'stalemate';
    case 'insufficient_material': return 'insufficient material';
    case 'threefold': return 'threefold repetition';
    case 'fifty_move': return 'fifty-move rule';
    default: return r || 'agreement';
  }
}

function PlayerBar({ player, clock, active, you }) {
  const name = player?.name || 'Waiting…';
  const rating = player?.rating != null ? player.rating : '?';
  const init = (player?.name || '?').slice(0, 1).toUpperCase();
  const low = clock != null && clock < 15000;
  return (
    <div className="playerbar">
      <div className="av" style={{ background: player ? 'var(--primary-2)' : 'var(--panel-2)' }}>{init}</div>
      <div className="info">
        <div className="nm">{name}{you ? ' (you)' : ''}</div>
        <div className="rt">Rating <b>{rating}</b></div>
      </div>
      <div className={`clock ${clock != null && clock <= 0 ? 'flag' : ''} ${low ? 'low' : ''} ${active ? 'active' : ''}`}>
        {fmtClock(clock)}
      </div>
    </div>
  );
}

function Controls({ game, socket, disabled }) {
  const status = game.status;
  return (
    <div>
      <div className="controls">
        <button className="btn danger small" disabled={disabled || status !== 'playing'} onClick={() => socket.emit('game:resign')}>Resign</button>
        <button className="btn ghost small" disabled={disabled || status !== 'playing'} onClick={() => socket.emit('game:offerDraw')}>Offer draw</button>
        <button className="btn ghost small" disabled={disabled || status !== 'playing'} onClick={() => socket.emit('game:agreeDraw')}>Agree draw</button>
        {status === 'over' && (
          <button className="btn green small" onClick={() => socket.emit('game:rematch')}>Rematch</button>
        )}
      </div>
      <div className="caption" style={{ textAlign: 'center' }}>
        Room code: <b style={{ letterSpacing: 1 }}>{game.code}</b>
      </div>
    </div>
  );
}

function GameOverBanner({ game, resultText, socket }) {
  return (
    <div className="card" style={{ width: '100%', maxWidth: 560, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <b style={{ fontSize: 15 }}>{resultText}</b>
        <div className="caption">Final position: {game.moves.length} moves</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn green small" onClick={() => socket.emit('game:rematch')}>Rematch</button>
      </div>
    </div>
  );
}
