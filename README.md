# ChessTool

A fast Stockfish 18 analysis tool that shows the best move instantly and labels it the way
chess.com's Game Review does: **!! Brilliant**, **! Great**, **★ Best**, and for moves you
play, **Excellent / Good / Inaccuracy / Mistake / Blunder**.

It ships in two forms that share the same UI (`app/`):

| | What you get |
|---|---|
| **Windows .exe** (`desktop/`) | A standalone analysis board (Electron). No install needed with the portable build. |
| **Browser extension** (`extension/`, Chrome / Edge / Brave) | The same board in the browser side panel, plus a best-move overlay on chess.com **bot games** and the **chess.com analysis board**. |

## Features

- **Fast**: Stockfish 18 (WASM) streams results, so the best-move arrow appears within milliseconds and sharpens as it searches (default 1.5 s, adjustable 0.3–10 s).
- **Brilliant-move detection**: a sacrifice detector (legal-capture based, so it handles pins and checks) combined with expected-win% math, close to chess.com's criteria.
- **Game review**: per-move labels plus an accuracy score for each side.
- **chess.com import**: type your username to list recent finished games (via chess.com's public API), then click one to review it.
- Paste any FEN or PGN, play moves by click or drag, arrow-key navigation, `Space` plays the best move, `F` flips the board.

## Fair play on chess.com

The overlay switches on **only** on `chess.com/play/computer` (games vs bots) and `chess.com/analysis`.
It stays off in every game against a person, rated or unrated, live or daily. chess.com's Fair Play
policy bans engine assistance in those games and closes accounts for it. To analyze a game against
a person, finish it first, then import it (or paste the PGN) for a full review.

## Download / build

### Windows .exe
Every push runs the GitHub Actions workflow **Build**, which uploads `ChessTool-x.y.z-portable.exe`
and `ChessTool-x.y.z-setup.exe` as artifacts. Pushing a `v*` tag attaches them to a GitHub Release.

To build locally (on Windows):

```bash
npm install
npm run dist:win
```

The output goes to `desktop/release/`. Run the app without packaging: `npm run desktop`.

### Browser extension
```bash
npm install
npm run build
```
Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the
`extension/` folder. (Alternatively, `dist/chesstool-extension.zip` is the same thing zipped.)

Click the toolbar icon to open the analysis board in the side panel. On chess.com bot games the
floating panel appears bottom-right; `Alt+B` toggles it.

## Layout

```
app/          shared UI: board, engine wrapper, classifier, chess.com importer
extension/    MV3 manifest, background router, offscreen Stockfish host, chess.com overlay
desktop/      Electron shell (serves app/ over a secure custom scheme)
scripts/      build.mjs (vendors Stockfish + chess.js, assembles targets), classifier tests
```

## License

GPL-3.0. Bundles [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0) and
[chess.js](https://github.com/jhlywa/chess.js) (BSD-2).
