// Quick checks for the sacrifice detector / classifier (run: npm test after npm run build).
import assert from 'node:assert/strict';
import { sacrificeAmount, classifyPlayed, classifyBest, winPct } from '../app/classify.js';

// Plain developing move: no sacrifice.
assert.equal(sacrificeAmount('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3') <= 0, true);
// Bxf7+ in the Italian (bishop for pawn, defended by king): a sacrifice.
const italian = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
assert.ok(sacrificeAmount(italian, 'c4f7') >= 2, 'Bxf7+ should be a sac');
// Equal trade is not a sac: Nxe5 Nxe5 (knight takes defended pawn → loses N for P = sac); dxc6-style equal trade:
assert.ok(sacrificeAmount('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'b5c6') <= 0, 'Bxc6 is a trade');
// Queen hanging to a pawn.
assert.ok(sacrificeAmount('rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2', 'd1d1') === 0);

// Classification thresholds.
const before = { lines: [{ score: { cp: 30 }, pv: ['e2e4'] }, { score: { cp: 20 }, pv: ['d2d4'] }] };
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
assert.equal(classifyPlayed(start, 'e2e4', before, { cp: 30 }), 'best');
assert.equal(classifyPlayed(start, 'g2g4', before, { cp: -60 }), 'inaccuracy');
assert.equal(classifyPlayed(start, 'f2f3', before, { cp: -400 }), 'blunder');
// Only move → great.
const only = { lines: [{ score: { cp: 0 }, pv: ['g1f3'] }, { score: { cp: -500 }, pv: ['a2a3'] }] };
assert.equal(classifyBest(start, only).label, 'great');
// Sound sacrifice → brilliant.
const sac = { lines: [{ score: { cp: 150 }, pv: ['c4f7'] }, { score: { cp: 40 }, pv: ['e1g1'] }] };
assert.equal(classifyBest(italian, sac).label, 'brilliant');
// Qxg2 with a rook already hanging on h8 is NOT a sacrifice.
assert.ok(sacrificeAmount('r1b1kbnr/pppp1Npp/8/6q1/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 5', 'g5g2') < 2, 'pre-existing hanging piece');
assert.ok(Math.abs(winPct(0) - 50) < 1e-9);
console.log('classify tests passed');
