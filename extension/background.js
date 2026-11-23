// Routes analysis requests from the chess.com content script to Stockfish,
// which runs in an offscreen document (service workers can't host Workers).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let creating = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the Stockfish WASM engine in a Web Worker',
    }).finally(() => { creating = null; });
  }
  await creating;
}

const ports = new Map(); // job id -> port
let nextId = 1;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chesstool') return;
  port.onMessage.addListener(async (m) => {
    if (m.type === 'analyze') {
      const id = nextId++;
      ports.set(id, port);
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'analyze', id, fen: m.fen, movetime: m.movetime, multipv: m.multipv });
    } else if (m.type === 'stop') {
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    } else if (m.type === 'open-board') {
      chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html?fen=' + encodeURIComponent(m.fen)) });
    }
  });
  port.onDisconnect.addListener(() => {
    for (const [id, p] of ports) if (p === port) ports.delete(id);
  });
});

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== 'background') return;
  const port = ports.get(m.id);
  if (!port) return;
  try { port.postMessage(m); } catch { ports.delete(m.id); }
  if (m.type === 'done') ports.delete(m.id);
});
