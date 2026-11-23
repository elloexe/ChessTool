// Minimal dependency-free chess board: click or drag to move, highlights,
// legal-move dots and SVG arrows.

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

export class Board {
  constructor(el, { onMove }) {
    this.el = el;
    this.onMove = onMove;
    this.flipped = false;
    this.game = null;
    this.selected = null;
    this.lastMove = null;
    this.arrows = [];
    this._drag = null;
    el.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._moveDrag(e));
    window.addEventListener('pointerup', (e) => this._up(e));
  }

  set(game, lastMove) {
    this.game = game;
    this.lastMove = lastMove;
    this.selected = null;
    this.render();
  }

  flip() { this.flipped = !this.flipped; this.render(); }

  setArrows(arrows) { this.arrows = arrows; this._drawArrows(); }

  _squares() {
    const out = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const file = this.flipped ? 7 - f : f;
      const rank = this.flipped ? r + 1 : 8 - r;
      out.push(FILES[file] + rank);
    }
    return out;
  }

  render() {
    const g = this.game;
    const legal = this.selected ? g.moves({ square: this.selected, verbose: true }) : [];
    const targets = new Map(legal.map((m) => [m.to, m]));
    const checkSq = g.inCheck() ? this._kingSquare(g.turn()) : null;
    this.el.innerHTML = '';
    for (const sq of this._squares()) {
      const fi = FILES.indexOf(sq[0]);
      const ri = +sq[1];
      const d = document.createElement('div');
      d.className = 'sq ' + ((fi + ri) % 2 === 0 ? 'd' : 'l');
      d.dataset.sq = sq;
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to)) d.classList.add('last');
      if (sq === this.selected) d.classList.add('sel');
      if (sq === checkSq) d.classList.add('check');
      const p = g.get(sq);
      if (targets.has(sq)) d.classList.add(p ? 'cap' : 'dot');
      if (p) {
        const s = document.createElement('span');
        s.className = 'pc ' + p.color;
        s.textContent = GLYPH[p.type] + '︎';
        d.appendChild(s);
      }
      const bottomRank = this.flipped ? '8' : '1';
      const leftFile = this.flipped ? 'h' : 'a';
      if (sq[1] === bottomRank) d.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
      if (sq[0] === leftFile) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
      this.el.appendChild(d);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'arrows';
    svg.setAttribute('viewBox', '0 0 800 800');
    this.el.appendChild(svg);
    this._drawArrows();
  }

  _kingSquare(color) {
    for (const row of this.game.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
    return null;
  }

  _center(sq) {
    let f = FILES.indexOf(sq[0]);
    let r = 8 - +sq[1];
    if (this.flipped) { f = 7 - f; r = 7 - r; }
    return [f * 100 + 50, r * 100 + 50];
  }

  _drawArrows() {
    const svg = this.el.querySelector('#arrows');
    if (!svg) return;
    svg.innerHTML = '';
    for (const a of this.arrows) {
      const [x1, y1] = this._center(a.from);
      const [x2, y2] = this._center(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const w = a.width || 18, head = w * 2.2;
      const sx = x1 + ux * 25, sy = y1 + uy * 25;
      const ex = x2 - ux * head, ey = y2 - uy * head;
      const px = -uy, py = ux;
      const pts = [
        [sx + px * w / 2, sy + py * w / 2], [ex + px * w / 2, ey + py * w / 2],
        [ex + px * head / 1.4, ey + py * head / 1.4], [x2 - ux * 8, y2 - uy * 8],
        [ex - px * head / 1.4, ey - py * head / 1.4], [ex - px * w / 2, ey - py * w / 2],
        [sx - px * w / 2, sy - py * w / 2],
      ];
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      poly.setAttribute('fill', a.color || 'rgba(27,172,166,.85)');
      svg.appendChild(poly);
    }
  }

  _sqFromEvent(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sq');
    return t && this.el.contains(t) ? t.dataset.sq : null;
  }

  _tryMove(from, to) {
    const m = this.game.moves({ square: from, verbose: true }).find((x) => x.to === to);
    if (!m) return false;
    this.onMove({ from, to, promotion: m.promotion ? 'q' : undefined });
    return true;
  }

  _down(e) {
    const sq = this._sqFromEvent(e);
    if (!sq) return;
    if (this.selected && this.selected !== sq && this._tryMove(this.selected, sq)) return;
    const p = this.game.get(sq);
    if (p && p.color === this.game.turn()) {
      this.selected = sq;
      this.render();
      const pcEl = this.el.querySelector(`.sq[data-sq="${sq}"] .pc`);
      const ghost = pcEl.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.fontSize = getComputedStyle(pcEl).fontSize;
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      document.body.appendChild(ghost);
      pcEl.classList.add('dragging');
      this._drag = { from: sq, ghost };
    } else {
      this.selected = null;
      this.render();
    }
  }

  _moveDrag(e) {
    if (!this._drag) return;
    this._drag.ghost.style.left = e.clientX + 'px';
    this._drag.ghost.style.top = e.clientY + 'px';
  }

  _up(e) {
    if (!this._drag) return;
    const { from, ghost } = this._drag;
    ghost.remove();
    this._drag = null;
    const to = this._sqFromEvent(e);
    if (to && to !== from && this._tryMove(from, to)) return;
    this.render(); // keep selection for click-click moves
  }
}
