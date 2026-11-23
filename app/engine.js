// Thin UCI wrapper around Stockfish running in a Web Worker.
// Streams `info` updates and handles stop/restart races so the UI can
// re-analyze on every move without waiting.

export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this._line(String(e.data));
    this.worker.onerror = (e) => this.onError?.(e);
    this.ready = false;
    this.searching = false;
    this.pending = null;   // next job waiting for the current search to stop
    this.job = null;       // current job
    this._waiters = [];
  }

  send(cmd) { this.worker.postMessage(cmd); }

  _waitFor(prefix) {
    return new Promise((resolve) => this._waiters.push({ prefix, resolve }));
  }

  async init({ hash = 64, multipv = 3 } = {}) {
    this.send('uci');
    await this._waitFor('uciok');
    this.send(`setoption name Hash value ${hash}`);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.multipv = multipv;
    this.send('isready');
    await this._waitFor('readyok');
    this.ready = true;
  }

  setMultiPV(n) {
    this.multipv = n;
    this._pendingOptions = `setoption name MultiPV value ${n}`;
  }

  /**
   * Analyze a FEN. Returns a promise resolving to the final result.
   * opts: { movetime, depth, onInfo(result) }
   */
  analyze(fen, opts = {}) {
    return new Promise((resolve) => {
      const job = { fen, opts, resolve, lines: [], depth: 0, turn: fen.split(' ')[1] };
      if (this.pending) this.pending.resolve(null); // superseded
      if (this.searching) {
        this.pending = job;
        this.send('stop');
      } else {
        this._start(job);
      }
    });
  }

  stop() {
    if (this.pending) { this.pending.resolve(null); this.pending = null; }
    if (this.searching) this.send('stop');
  }

  _start(job) {
    this.job = job;
    this.searching = true;
    if (this._pendingOptions) { this.send(this._pendingOptions); this._pendingOptions = null; }
    this.send(`position fen ${job.fen}`);
    const { movetime, depth } = job.opts;
    this.send(depth ? `go depth ${depth}` : `go movetime ${Math.round(movetime || 1500)}`);
  }

  _line(line) {
    for (let i = 0; i < this._waiters.length; i++) {
      if (line.startsWith(this._waiters[i].prefix)) {
        this._waiters.splice(i, 1)[0].resolve(line);
        return;
      }
    }
    const job = this.job;
    if (!job) return;

    if (line.startsWith('info') && line.includes(' pv ')) {
      const info = parseInfo(line, job.turn);
      if (!info) return;
      job.lines[info.multipv - 1] = info;
      job.depth = Math.max(job.depth, info.depth);
      // Only emit once all PV slots at this depth are filled (avoids flicker).
      if (info.multipv === 1 || info.multipv === job.lines.length) {
        job.opts.onInfo?.(snapshot(job));
      }
    } else if (line.startsWith('bestmove')) {
      this.searching = false;
      const best = line.split(' ')[1];
      const res = snapshot(job);
      res.bestmove = best && best !== '(none)' ? best : null;
      this.job = null;
      job.resolve(res);
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this._start(next);
      }
    }
  }
}

function snapshot(job) {
  return {
    fen: job.fen,
    depth: job.depth,
    lines: job.lines.filter(Boolean).map((l) => ({ ...l, pv: [...l.pv] })),
  };
}

// Scores are converted to White's point of view.
function parseInfo(line, turn) {
  const t = line.split(' ');
  const get = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : undefined; };
  const depth = +get('depth');
  const multipv = +(get('multipv') || 1);
  const si = t.indexOf('score');
  if (si < 0) return null;
  const kind = t[si + 1];
  let val = +t[si + 2];
  if (t[si + 3] === 'lowerbound' || t[si + 3] === 'upperbound') return null;
  if (turn === 'b') val = -val;
  const pv = t.slice(t.indexOf('pv') + 1);
  return { depth, multipv, score: kind === 'mate' ? { mate: val } : { cp: val }, pv };
}
