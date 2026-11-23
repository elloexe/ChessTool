// ChessTool overlay for chess.com.
//
// Fair play: this ONLY activates on chess.com's "Play vs Computer" page and
// the analysis board. It stays off in every game against a human (rated or
// unrated, live or daily), because chess.com's Fair Play policy forbids
// engine assistance there and the tool would get your account closed.

(() => {
  const ALLOWED = [/^\/play\/computer/, /^\/analysis/];
  const allowed = () => ALLOWED.some((r) => r.test(location.pathname));

  const PIECE = { wp: 'P', wn: 'N', wb: 'B', wr: 'R', wq: 'Q', wk: 'K', bp: 'p', bn: 'n', bb: 'b', br: 'r', bq: 'q', bk: 'k' };
  const LABEL = { brilliant: '!! Brilliant', great: '! Great', best: '★ Best' };

  let enabled = true;
  let port = null;
  let lastFen = null;
  let lastBoardKey = null;
  let lastTurn = 'w';
  let prevGrid = null;
  let panel, svg, boardEl;
  let settings = { movetime: 1000, multipv: 3 };

  chrome.storage?.local.get(['ct_enabled', 'ct_movetime']).then((s) => {
    if (s.ct_enabled === false) enabled = false;
    if (s.ct_movetime) settings.movetime = s.ct_movetime;
    updatePanelState();
  });

  function connect() {
    port = chrome.runtime.connect({ name: 'chesstool' });
    port.onMessage.addListener(onResult);
    port.onDisconnect.addListener(() => { port = null; });
  }
  function send(m) {
    if (!port) connect();
    try { port.postMessage(m); } catch { port = null; connect(); port.postMessage(m); }
  }

  // ---- reading the board ---------------------------------------------------
  function findBoard() {
    return document.querySelector('wc-chess-board, chess-board, #board-play-computer, #board-analysis-board, .board');
  }

  function readGrid(el) {
    const grid = {}; // "e4" -> "P"
    el.querySelectorAll('.piece').forEach((p) => {
      let type = null, sq = null;
      for (const c of p.classList) {
        if (PIECE[c]) type = PIECE[c];
        const m = /^square-(\d)(\d)$/.exec(c);
        if (m) sq = 'abcdefgh'[+m[1] - 1] + m[2];
      }
      if (type && sq && !p.classList.contains('dragging')) grid[sq] = type;
    });
    return grid;
  }

  function highlightSquares(el) {
    const out = [];
    el.querySelectorAll('.highlight').forEach((h) => {
      for (const c of h.classList) {
        const m = /^square-(\d)(\d)$/.exec(c);
        if (m) out.push('abcdefgh'[+m[1] - 1] + m[2]);
      }
    });
    return out;
  }

  function sideToMove(grid, el) {
    // The last-move highlight contains the piece that just moved.
    for (const sq of highlightSquares(el)) {
      const p = grid[sq];
      if (p) return p === p.toUpperCase() ? 'b' : 'w';
    }
    // Fallback: diff with the previous position.
    if (prevGrid) {
      for (const sq in grid) {
        if (prevGrid[sq] !== grid[sq]) return grid[sq] === grid[sq].toUpperCase() ? 'b' : 'w';
      }
    }
    return lastTurn;
  }

  function toFen(grid, turn, el) {
    let rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (const f of 'abcdefgh') {
        const p = grid[f + r];
        if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let castle = '';
    if (grid.e1 === 'K') { if (grid.h1 === 'R') castle += 'K'; if (grid.a1 === 'R') castle += 'Q'; }
    if (grid.e8 === 'k') { if (grid.h8 === 'r') castle += 'k'; if (grid.a8 === 'r') castle += 'q'; }
    // En passant from a just-played double pawn push.
    let ep = '-';
    const hl = highlightSquares(el);
    if (hl.length === 2) {
      const [a, b] = hl;
      const to = grid[a] ? a : b, from = to === a ? b : a;
      const p = grid[to];
      if ((p === 'P' || p === 'p') && from[0] === to[0] && Math.abs(+from[1] - +to[1]) === 2) {
        ep = from[0] + (p === 'P' ? '3' : '6');
      }
    }
    return `${rows.join('/')} ${turn} ${castle || '-'} ${ep} 0 1`;
  }

  // ---- overlay ---------------------------------------------------------------
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return;
    panel = document.createElement('div');
    panel.id = 'chesstool-panel';
    panel.innerHTML = `
      <div class="ct-head"><b>♞ ChessTool</b><span class="ct-depth"></span>
        <button class="ct-toggle" title="Turn the overlay on or off (Alt+B)"></button></div>
      <div class="ct-best"><span class="ct-san">…</span><span class="ct-badge"></span></div>
      <div class="ct-why"></div>
      <ol class="ct-lines"></ol>
      <div class="ct-foot">
        <label>Think <select class="ct-time"><option value="300">0.3s</option><option value="1000">1s</option><option value="2000">2s</option><option value="5000">5s</option></select></label>
        <button class="ct-open">Open board</button>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.ct-toggle').onclick = toggle;
    panel.querySelector('.ct-open').onclick = () => lastFen && send({ type: 'open-board', fen: lastFen });
    const sel = panel.querySelector('.ct-time');
    sel.value = String(settings.movetime);
    sel.onchange = () => {
      settings.movetime = +sel.value;
      chrome.storage?.local.set({ ct_movetime: settings.movetime });
      lastFen = null;
      tick();
    };
    updatePanelState();
  }

  function updatePanelState() {
    if (!panel) return;
    panel.classList.toggle('ct-off', !enabled);
    panel.querySelector('.ct-toggle').textContent = enabled ? 'On' : 'Off';
    if (!enabled) clearArrows();
  }

  function toggle() {
    enabled = !enabled;
    chrome.storage?.local.set({ ct_enabled: enabled });
    lastFen = null;
    updatePanelState();
    if (enabled) tick(); else send({ type: 'stop' });
  }

  function ensureSvg() {
    if (svg && boardEl && boardEl.contains(svg)) return;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.id = 'chesstool-arrows';
    boardEl.appendChild(svg);
  }

  function clearArrows() { if (svg) svg.innerHTML = ''; }

  function center(sq, flipped) {
    let f = 'abcdefgh'.indexOf(sq[0]), r = 8 - +sq[1];
    if (flipped) { f = 7 - f; r = 7 - r; }
    return [f * 100 + 50, r * 100 + 50];
  }

  function drawArrow(uci, color, width) {
    const flipped = boardEl.classList.contains('flipped');
    const [x1, y1] = center(uci.slice(0, 2), flipped);
    const [x2, y2] = center(uci.slice(2, 4), flipped);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const w = width, head = w * 2.2, px = -uy, py = ux;
    const sx = x1 + ux * 25, sy = y1 + uy * 25, ex = x2 - ux * head, ey = y2 - uy * head;
    const pts = [[sx + px * w / 2, sy + py * w / 2], [ex + px * w / 2, ey + py * w / 2], [ex + px * head / 1.4, ey + py * head / 1.4],
      [x2 - ux * 8, y2 - uy * 8], [ex - px * head / 1.4, ey - py * head / 1.4], [ex - px * w / 2, ey - py * w / 2], [sx - px * w / 2, sy - py * w / 2]];
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', color);
    svg.appendChild(poly);
  }

  function onResult(m) {
    if (!enabled || !allowed() || m.fen !== lastFen || !m.result) return;
    const r = m.result;
    ensurePanel();
    ensureSvg();
    clearArrows();
    const best = r.lines[0];
    if (!best) return;
    if (r.lines[1]) drawArrow(r.lines[1].uci, 'rgba(120,120,120,.5)', 12);
    drawArrow(best.uci, r.label === 'brilliant' ? 'rgba(27,172,166,.9)' : 'rgba(129,182,76,.9)', 18);
    panel.querySelector('.ct-san').textContent = best.san[0] || best.uci;
    const badge = panel.querySelector('.ct-badge');
    badge.textContent = LABEL[r.label] || '';
    badge.className = 'ct-badge ' + (r.label || '');
    panel.querySelector('.ct-why').textContent = (r.why ? r.why + ' ' : '') + 'Eval ' + best.score;
    panel.querySelector('.ct-depth').textContent = `d${r.depth}`;
    const ol = panel.querySelector('.ct-lines');
    ol.innerHTML = '';
    for (const l of r.lines) {
      const li = document.createElement('li');
      li.textContent = `${l.score}  ${l.san.join(' ')}`;
      ol.appendChild(li);
    }
  }

  // ---- main loop -------------------------------------------------------------
  function tick() {
    if (!allowed()) {
      if (panel) panel.remove();
      panel = null;
      clearArrows();
      if (lastFen) send({ type: 'stop' });
      lastFen = null;
      return;
    }
    ensurePanel();
    if (!enabled) return;
    boardEl = findBoard();
    if (!boardEl) return;
    const grid = readGrid(boardEl);
    if (Object.keys(grid).length < 2) return;
    const key = JSON.stringify(grid) + highlightSquares(boardEl).join();
    if (key === lastBoardKey && lastFen) return;
    const turn = sideToMove(grid, boardEl);
    prevGrid = grid;
    lastBoardKey = key;
    lastTurn = turn;
    const fen = toFen(grid, turn, boardEl);
    if (fen === lastFen) return;
    lastFen = fen;
    clearArrows();
    if (panel) panel.querySelector('.ct-san').textContent = '…';
    send({ type: 'analyze', fen, movetime: settings.movetime, multipv: settings.multipv });
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(tick, 120); };
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  setInterval(tick, 1000); // also catches SPA navigation
  document.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'b' || e.key === 'B') && allowed()) toggle(); });
  tick();
})();
