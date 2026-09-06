import { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';

export default function ChessboardView({
  fen, orientation = 'white', canMove, myColor, lastMove, onMove, onPromotion, onSelectSquare, selected,
  legalMoves = [], interactive = true,
}) {
  // Highlight the squares of the last move (from/to).
  const highlight = useMemo(() => {
    const s = {};
    if (lastMove) {
      s[lastMove.from] = { backgroundColor: 'rgba(244,197,66,.42)' };
      s[lastMove.to] = { backgroundColor: 'rgba(244,197,66,.42)' };
    }
    if (selected) s[selected] = { backgroundColor: 'rgba(244,197,66,.55)' };

    // "Show hints" — mark every square a selected piece can legally move to.
    // Empty targets get a translucent dot; capturable targets get a ring.
    const DOT = 'radial-gradient(circle, rgba(0,0,0,.25) 24%, rgba(0,0,0,0) 25%)';
    for (const m of legalMoves) {
      if (m.capture) {
        s[m.to] = { boxShadow: 'inset 0 0 0 4px rgba(0,0,0,.22)' };
      } else if (!s[m.to]) {
        s[m.to] = { backgroundImage: DOT };
      }
    }
    return s;
  }, [lastMove, selected, legalMoves]);

  const handleDrop = (source, target, piece) => {
    if (!interactive || !canMove) return false;
    // react-chessboard opens its promotion dialog for promotions and calls onPromotion;
    // normal moves come through onPieceDrop.
    onMove(source, target);
    return true;
  };

  return (
    <Chessboard
      id="main"
      position={fen}
      boardOrientation={orientation}
      showPromotionDialog
      arePiecesDraggable={interactive && canMove}
      animationDuration={120}
      boardWidth={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 40 : 560)}
      customBoardStyle={{ borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,.45)', overflow: 'hidden' }}
      customDarkSquareStyle={{ backgroundColor: '#769656' }}
      customLightSquareStyle={{ backgroundColor: '#eaefd3' }}
      customNotationStyle={{ color: '#eaefd3', fontSize: '12px', fontWeight: 600 }}
      customSquareStyles={highlight}
      onPieceDrop={handleDrop}
      onPromotionPieceSelect={(piece, from, to) => {
        onPromotion(piece, from, to);
        return true;
      }}
      onPieceClick={(piece, square) => onSelectSquare && onSelectSquare(square, piece)}
      onSquareClick={(square) => onSelectSquare && onSelectSquare(square, undefined)}
    />
  );
}
