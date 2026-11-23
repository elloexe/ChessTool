// chess.com-style move classification (Brilliant / Great / Best / Excellent /
// Good / Inaccuracy / Mistake / Blunder) built on expected-win% loss plus a
// sacrifice detector. Heuristic, but close to what Game Review shows.

import { Chess } from './vendor/chess.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const LABELS = {
  brilliant: { text: 'Brilliant', sym: '!!' },
  great: { text: 'Great', sym: '!' },
  best: { text: 'Best', sym: '★' },
  excellent: { text: 'Excellent', sym: '👍' },
  good: { text: 'Good', sym: '✓' },
  inaccuracy: { text: 'Inaccuracy', sym: '?!' },
  mistake: { text: 'Mistake', sym: '?' },
  blunder: { text: 'Blunder', sym: '??' },
  book: { text: 'Book', sym: '📖' },
};

/** Score object {cp}|{mate} (White POV) → centipawns, mates mapped to large values. */
export function toCp(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return 0;
    return Math.sign(score.mate) * (10000 - Math.abs(score.mate) * 10);
  }
  return score.cp;
}

/** Expected win percentage (0–100) for White from centipawns. */
export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win% from the point of view of `color` ('w' | 'b'). */
export function winFor(score, color) {
  const w = winPct(toCp(score));
  return color === 'w' ? w : 100 - w;
}

export function formatScore(score) {
  if (!score) return '0.0';
  if (score.mate !== undefined) return (score.mate > 0 ? '+M' : '-M') + Math.abs(score.mate);
  const v = score.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

/**
 * Does playing `uci` in `fen` give away material? Returns the net material
 * (in pawns) the mover can lose to the opponent's best immediate capture.
 */
export function sacrificeAmount(fen, uci) {
  const g = new Chess(fen);
  const us = g.turn();
  let mv;
  try {
    mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch { return 0; }
  if (!mv) return 0;
  const gained = mv.captured ? VALUE[mv.captured] : 0;
  if (g.isCheckmate()) return 0;

  const before = threatsAgainst(nullMove(fen), us);
  const after = threatsAgainst(g, us);
  let worst = 0;
  for (const [sq, loss] of Object.entries(after)) {
    // Only count material the move itself puts en prise: the moved piece, or
    // pieces that weren't already hanging before the move.
    if (sq !== mv.to && before && (before[sq] ?? -1) >= loss) continue;
    if (loss > worst) worst = loss;
  }
  const promo = mv.promotion ? VALUE[mv.promotion] - 1 : 0;
  return worst - gained - promo;
}

/** Position with the same placement but the opponent to move (or null). */
function nullMove(fen) {
  const t = fen.split(' ');
  t[1] = t[1] === 'w' ? 'b' : 'w';
  t[3] = '-';
  try { return new Chess(t.join(' ')); } catch { return null; }
}

/** For each of `us`'s pieces the side to move in `g` can capture: material lost. */
function threatsAgainst(g, us) {
  if (!g || g.turn() === us) return null;
  const cheapest = {};
  for (const m of g.moves({ verbose: true })) {
    if (!m.captured) continue;
    const v = VALUE[m.piece];
    if (cheapest[m.to] === undefined || v < cheapest[m.to]) cheapest[m.to] = v;
  }
  const out = {};
  for (const [sq, attackerVal] of Object.entries(cheapest)) {
    const p = g.get(sq);
    if (!p || p.color !== us || p.type === 'k') continue;
    const defended = g.attackers(sq, us).length > 0;
    out[sq] = defended ? VALUE[p.type] - attackerVal : VALUE[p.type];
  }
  return out;
}

/**
 * Classify the engine's top move in a position (what the "Best move" card shows).
 * analysis: { lines: [{score, pv}] } for `fen`.
 */
export function classifyBest(fen, analysis) {
  const lines = analysis?.lines || [];
  if (!lines.length) return null;
  const color = fen.split(' ')[1];
  const top = lines[0];
  const best = winFor(top.score, color);
  const second = lines[1] ? winFor(lines[1].score, color) : null;
  const sac = sacrificeAmount(fen, top.pv[0]);

  if (sac >= 2 && best >= 50 && !(second !== null && second > 97)) {
    return { label: 'brilliant', why: `Sacrifices ${sac} point${sac > 1 ? 's' : ''} of material — and it works.` };
  }
  if (second !== null && best - second >= 15) {
    return { label: 'great', why: 'Only move: every alternative is clearly worse.' };
  }
  if (top.score.mate > 0 && color === 'w' || top.score.mate < 0 && color === 'b') {
    return { label: 'best', why: `Forced mate in ${Math.abs(top.score.mate)}.` };
  }
  return { label: 'best', why: '' };
}

/**
 * Classify a move that was actually played.
 * before: analysis of the position before the move (needs lines[0]).
 * afterScore: White-POV score of the position after the move.
 */
export function classifyPlayed(fenBefore, uci, before, afterScore) {
  const color = fenBefore.split(' ')[1];
  const top = before?.lines?.[0];
  if (!top || !afterScore) return null;
  const bestWin = winFor(top.score, color);
  const playedWin = winFor(afterScore, color);
  const loss = Math.max(0, bestWin - playedWin);
  const isBest = top.pv[0] === uci || loss < 1;

  if (loss <= 2 && playedWin >= 50 && bestWin < 97 && sacrificeAmount(fenBefore, uci) >= 2) return 'brilliant';
  if (isBest) {
    const second = before.lines[1] ? winFor(before.lines[1].score, color) : null;
    if (second !== null && bestWin - second >= 15) return 'great';
    return 'best';
  }
  if (loss <= 2) return 'excellent';
  if (loss <= 5) return 'good';
  if (loss <= 10) return 'inaccuracy';
  if (loss <= 20) return 'mistake';
  return 'blunder';
}

/** Accuracy (0–100) per chess.com/lichess-style formula from average win% loss. */
export function accuracyFromLoss(avgLoss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avgLoss) - 3.1669));
}
