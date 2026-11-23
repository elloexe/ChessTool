import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js';
import { Board } from './board.js';
import { classifyBest, classifyPlayed, formatScore, winFor, toCp, winPct, accuracyFromLoss, LABELS } from './classify.js';
import { fetchRecentGames } from './chesscom.js';

const $ = (id) => document.getElementById(id);

// ---- state ---------------------------------------------------------------
let startFen = new Chess().fen();
let history = [];         // [{ san, uci, fen }] — fen = position AFTER the move
let cursor = 0;           // number of moves applied
const cache = new Map();  // fen → final analysis
let current = null;       // latest (possibly partial) analysis for displayed fen
let reviewing = false;

const settings = loadSettings();
$('think').value = settings.think;
$('multipv').value = settings.multipv;
$('auto').checked = settings.auto;
$('think-out').textContent = settings.think + 's';

const board = new Board($('board'), { onMove: (m) => playMove(m) });
const engine = new Engine('./vendor/stockfish.js');
engine.onError = () => setStatus('Engine failed to load', true);

engine.init({ multipv: +settings.multipv }).then(() => {
  setStatus('Stockfish 18 ready');
  refresh();
});

// ---- helpers -------------------------------------------------------------
function loadSettings() {
  const d = { think: 1.5, multipv: 3, auto: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem('chesstool') || '{}') }; } catch { return d; }
}
function saveSettings() {
  try { localStorage.setItem('chesstool', JSON.stringify(settings)); } catch {}
}
function setStatus(t, err) { $('engine-status').textContent = t; $('engine-status').style.color = err ? 'var(--bad)' : ''; }
function msg(t, err) { $('msg').textContent = t; $('msg').className = 'msg' + (err ? ' err' : ''); }

function fenAt(i) { return i === 0 ? startFen : history[i - 1].fen; }
function gameAt(i) { return new Chess(fenAt(i)); }

function uciToSan(fen, pv, max = 12) {
  const g = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try {
      const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch { break; }
  }
  return out;
}

// ---- moves / navigation --------------------------------------------------
function playMove({ from, to, promotion }) {
  const g = gameAt(cursor);
  let m;
  try { m = g.move({ from, to, promotion: promotion || 'q' }); } catch { return; }
  const uci = m.from + m.to + (m.promotion || '');
  const next = history[cursor];
  if (next && next.uci === uci) { cursor++; refresh(); return; }
  history = history.slice(0, cursor);
  history.push({ san: m.san, uci, fen: g.fen() });
  cursor++;
  refresh();
}

function go(i) { cursor = Math.max(0, Math.min(history.length, i)); refresh(); }

function refresh() {
  const g = gameAt(cursor);
  const last = cursor > 0 ? { from: history[cursor - 1].uci.slice(0, 2), to: history[cursor - 1].uci.slice(2, 4) } : null;
  board.set(g, last);
  renderMoves();
  const fen = g.fen();
  current = cache.get(fen) || null;
  renderAnalysis();
  if (g.isGameOver()) {
    engine.stop();
    $('best-san').textContent = g.isCheckmate() ? 'Checkmate' : 'Draw';
    $('best-badge').textContent = '';
    $('best-why').textContent = '';
    $('best').className = 'best';
    board.setArrows([]);
    if (g.isCheckmate()) {
      const whiteWon = g.turn() === 'b';
      $('evalfill').style.height = (whiteWon !== board.flipped ? 100 : 0) + '%';
      $('evaltext').textContent = whiteWon ? '1-0' : '0-1';
    }
    return;
  }
  if (engine.ready && $('auto').checked && !reviewing && !(current && current.final)) analyzeCurrent();
}

async function analyzeCurrent() {
  const fen = fenAt(cursor);
  setStatus('Thinking…');
  const res = await engine.analyze(fen, {
    movetime: settings.think * 1000,
    onInfo: (info) => { if (fen === fenAt(cursor)) { current = info; renderAnalysis(); } },
  });
  if (!res) return; // superseded by a newer position
  res.final = true;
  cache.set(fen, res);
  if (fen === fenAt(cursor)) { current = res; renderAnalysis(); }
  setStatus(`Depth ${res.depth} · Stockfish 18`);
  renderMoves();
}

// ---- rendering -----------------------------------------------------------
function renderAnalysis() {
  const fen = fenAt(cursor);
  const a = current;
  const lines = a?.lines || [];
  const turn = fen.split(' ')[1];

  // eval bar (White POV)
  const score = lines[0]?.score || { cp: 0 };
  const w = winPct(toCp(score));
  const flip = board.flipped;
  $('evalfill').style.height = (flip ? 100 - w : w) + '%';
  $('evalfill').style.background = flip ? '#403e3b' : '#f0f0f0';
  $('evalbar').style.background = flip ? '#f0f0f0' : '#403e3b';
  const et = $('evaltext');
  et.textContent = formatScore(score).replace('+', '');
  const whiteWinning = toCp(score) >= 0;
  et.className = whiteWinning !== flip ? '' : 'top';
  et.style.color = whiteWinning ? '#333' : '#eee';

  $('depth').textContent = a ? `depth ${a.depth}` : '';

  // best move card
  if (lines.length) {
    const best = lines[0];
    const san = uciToSan(fen, best.pv, 1)[0] || best.pv[0];
    const cls = classifyBest(fen, a);
    $('best-san').textContent = san;
    $('best-badge').textContent = cls ? `${LABELS[cls.label].sym} ${LABELS[cls.label].text}` : '';
    $('best-badge').className = 'badge ' + (cls?.label || '');
    $('best-why').textContent = (cls?.why ? cls.why + ' ' : '') + `Eval ${formatScore(best.score)}`;
    $('best').className = 'best ' + (cls?.label || '');
    const arrows = [{ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), color: cls?.label === 'brilliant' ? 'rgba(27,172,166,.9)' : 'rgba(129,182,76,.9)' }];
    if (lines[1]) arrows.push({ from: lines[1].pv[0].slice(0, 2), to: lines[1].pv[0].slice(2, 4), color: 'rgba(120,120,120,.45)', width: 12 });
    board.setArrows(arrows);
  } else {
    $('best-san').textContent = '…';
    $('best-badge').textContent = '';
    $('best-why').textContent = '';
    board.setArrows([]);
  }

  // top lines
  const ol = $('lines');
  ol.innerHTML = '';
  lines.forEach((l) => {
    const li = document.createElement('li');
    const sans = uciToSan(fen, l.pv);
    li.innerHTML = `<span class="score"></span> <span class="pv"></span>`;
    li.querySelector('.score').textContent = formatScore(l.score);
    li.querySelector('.pv').textContent = sans.join(' ');
    li.title = 'Click to play this move';
    li.onclick = () => playMove({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
    ol.appendChild(li);
  });

  // classification of the move that led here
  const lm = $('last-move');
  if (cursor > 0) {
    const prev = cache.get(fenAt(cursor - 1));
    const afterScore = a?.final ? lines[0]?.score : null;
    const label = prev && afterScore ? classifyPlayed(fenAt(cursor - 1), history[cursor - 1].uci, prev, afterScore) : null;
    history[cursor - 1].label = label || history[cursor - 1].label;
    if (label) {
      const bestSan = uciToSan(fenAt(cursor - 1), prev.lines[0].pv, 1)[0];
      lm.innerHTML = `<b></b> is <span class="tag ${label}">${LABELS[label].sym} ${LABELS[label].text}</span>` +
        (['best', 'brilliant', 'great'].includes(label) ? '' : ` — best was <b>${bestSan}</b>`);
      lm.querySelector('b').textContent = history[cursor - 1].san;
      lm.classList.remove('hidden');
    } else lm.classList.add('hidden');
  } else lm.classList.add('hidden');
  void turn;
}

function renderMoves() {
  const el = $('moves');
  el.innerHTML = '';
  const firstNum = +startFen.split(' ')[5];
  const blackFirst = startFen.split(' ')[1] === 'b';
  history.forEach((h, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    if (ply % 2 === 0 || i === 0) {
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = firstNum + Math.floor(ply / 2) + (ply % 2 ? '…' : '.');
      el.appendChild(n);
    }
    const s = document.createElement('span');
    s.className = 'mv' + (i + 1 === cursor ? ' cur' : '');
    s.textContent = h.san;
    if (h.label) {
      const t = document.createElement('span');
      t.className = 'tag ' + h.label;
      t.textContent = LABELS[h.label].sym;
      t.title = LABELS[h.label].text;
      s.appendChild(t);
    }
    s.onclick = () => go(i + 1);
    el.appendChild(s);
  });
  el.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}

// ---- loading -------------------------------------------------------------
function loadText(text) {
  text = text.trim();
  if (!text) return;
  const g = new Chess();
  try {
    if (/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}\s/.test(text) || /^[rnbqkpRNBQKP1-8/]+$/.test(text)) {
      const fen = text.split(/\s+/).length < 4 ? text.split(/\s+/)[0] + ' w - - 0 1' : text;
      g.load(fen);
      startFen = g.fen();
      history = [];
      cursor = 0;
    } else {
      g.loadPgn(text);
      const headers = g.getHeaders?.() || {};
      startFen = headers.FEN || new Chess().fen();
      const replay = new Chess(startFen);
      history = g.history({ verbose: true }).map((m) => {
        replay.move(m.san);
        return { san: m.san, uci: m.from + m.to + (m.promotion || ''), fen: replay.fen() };
      });
      cursor = history.length;
    }
    msg('Loaded.');
    refresh();
  } catch (e) {
    msg('Could not read that FEN/PGN: ' + (e.message || e), true);
  }
}

function toPgn() {
  const g = new Chess(startFen);
  if (startFen !== new Chess().fen()) { g.setHeader('SetUp', '1'); g.setHeader('FEN', startFen); }
  history.forEach((h) => g.move(h.san));
  return g.pgn();
}

// ---- game review ---------------------------------------------------------
async function review() {
  if (!history.length || reviewing) return;
  reviewing = true;
  const btn = $('btn-review');
  const time = Math.min(settings.think, 1) * 1000;
  for (let i = 0; i <= history.length; i++) {
    btn.textContent = `Reviewing ${i}/${history.length}…`;
    const fen = fenAt(i);
    if (cache.get(fen)?.final) continue;
    if (new Chess(fen).isGameOver()) continue;
    const res = await engine.analyze(fen, { movetime: time });
    if (!res) { reviewing = false; btn.textContent = 'Game review'; return; }
    res.final = true;
    cache.set(fen, res);
  }
  const loss = { w: [], b: [] };
  history.forEach((h, i) => {
    const before = cache.get(fenAt(i));
    const after = cache.get(h.fen);
    const color = fenAt(i).split(' ')[1];
    const g = new Chess(h.fen);
    const afterScore = g.isCheckmate() ? { mate: color === 'w' ? 1 : -1 } : after?.lines?.[0]?.score;
    if (!before || !afterScore) return;
    h.label = classifyPlayed(fenAt(i), h.uci, before, afterScore);
    loss[color].push(Math.max(0, winFor(before.lines[0].score, color) - winFor(afterScore, color)));
  });
  const acc = (arr) => arr.length ? accuracyFromLoss(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—';
  const count = (c, l) => history.filter((h, i) => h.label === l && fenAt(i).split(' ')[1] === c).length;
  $('review-out').innerHTML =
    `<div>Accuracy — White <b>${acc(loss.w)}</b> · Black <b>${acc(loss.b)}</b></div>` +
    `<div class="rv"><span></span><span>White</span><span>Black</span></div>` +
    ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']
      .map((l) => `<div class="rv"><span class="tag ${l}">${LABELS[l].sym} ${LABELS[l].text}</span><span>${count('w', l)}</span><span>${count('b', l)}</span></div>`).join('');
  reviewing = false;
  btn.textContent = 'Game review';
  refresh();
}

// ---- chess.com import ----------------------------------------------------
async function importChessCom() {
  const user = $('cc-user').value.trim();
  if (!user) return;
  try { localStorage.setItem('chesstool-user', user); } catch {}
  const list = $('cc-games');
  list.innerHTML = '<li>Loading…</li>';
  try {
    const games = await fetchRecentGames(user, 15);
    list.innerHTML = '';
    if (!games.length) list.innerHTML = '<li>No finished games found.</li>';
    for (const g of games) {
      const li = document.createElement('li');
      li.textContent = g.label;
      li.title = 'Load and review this game';
      li.onclick = () => { loadText(g.pgn); review(); };
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = '';
    msg('chess.com: ' + e.message, true);
  }
}
try { $('cc-user').value = localStorage.getItem('chesstool-user') || ''; } catch {}

// ---- wiring --------------------------------------------------------------
$('btn-start').onclick = () => go(0);
$('btn-back').onclick = () => go(cursor - 1);
$('btn-fwd').onclick = () => go(cursor + 1);
$('btn-end').onclick = () => go(history.length);
$('btn-flip').onclick = () => { board.flip(); renderAnalysis(); };
$('btn-new').onclick = () => { startFen = new Chess().fen(); history = []; cursor = 0; $('review-out').innerHTML = ''; refresh(); };
$('btn-play').onclick = () => {
  const best = current?.lines?.[0]?.pv?.[0];
  if (best) playMove({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
};
$('btn-load').onclick = () => loadText($('import').value);
$('btn-copy-fen').onclick = () => { navigator.clipboard.writeText(fenAt(cursor)); msg('FEN copied.'); };
$('btn-copy-pgn').onclick = () => { navigator.clipboard.writeText(toPgn()); msg('PGN copied.'); };
$('btn-review').onclick = review;
$('btn-cc').onclick = importChessCom;
$('cc-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') importChessCom(); });
$('think').oninput = (e) => { settings.think = +e.target.value; $('think-out').textContent = settings.think + 's'; saveSettings(); };
$('think').onchange = () => { cache.clear(); refresh(); };
$('multipv').onchange = (e) => { settings.multipv = +e.target.value; engine.setMultiPV(settings.multipv); saveSettings(); cache.clear(); refresh(); };
$('auto').onchange = (e) => { settings.auto = e.target.checked; saveSettings(); if (settings.auto) refresh(); else engine.stop(); };

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') go(cursor - 1);
  else if (e.key === 'ArrowRight') go(cursor + 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(history.length);
  else if (e.key === 'f' || e.key === 'F') $('btn-flip').click();
  else if (e.key === ' ') { e.preventDefault(); $('btn-play').click(); }
  else return;
});

// Allow ?fen=... or #pgn hand-off (used by the extension).
const params = new URLSearchParams(location.search);
if (params.get('fen')) loadText(params.get('fen'));
else if (params.get('pgn')) loadText(params.get('pgn'));
else refresh();
