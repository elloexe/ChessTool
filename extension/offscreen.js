import { Engine } from './app/engine.js';
import { classifyBest, formatScore } from './app/classify.js';
import { Chess } from './app/vendor/chess.js';

const engine = new Engine('app/vendor/stockfish.js');
const ready = engine.init({ multipv: 3, hash: 64 });
let multipv = 3;

function summarize(fen, res) {
  const lines = (res?.lines || []).map((l) => {
    const g = new Chess(fen);
    const san = [];
    for (const u of l.pv.slice(0, 8)) {
      try { san.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
    }
    return { uci: l.pv[0], san, score: formatScore(l.score), raw: l.score };
  });
  const cls = res?.lines?.length ? classifyBest(fen, res) : null;
  return { depth: res?.depth || 0, lines, label: cls?.label || null, why: cls?.why || '' };
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== 'offscreen') return;
  if (m.type === 'stop') { engine.stop(); return; }
  if (m.type !== 'analyze') return;
  ready.then(async () => {
    if (m.multipv && m.multipv !== multipv) { multipv = m.multipv; engine.setMultiPV(multipv); }
    let lastSent = 0;
    const res = await engine.analyze(m.fen, {
      movetime: m.movetime || 1000,
      onInfo: (info) => {
        const now = Date.now();
        if (now - lastSent < 120) return;
        lastSent = now;
        chrome.runtime.sendMessage({ target: 'background', type: 'info', id: m.id, fen: m.fen, result: summarize(m.fen, info) });
      },
    });
    chrome.runtime.sendMessage({ target: 'background', type: 'done', id: m.id, fen: m.fen, result: res ? summarize(m.fen, res) : null });
  });
});
