// Electron shell for ChessTool. Serves ./app over a custom secure scheme so
// Web Workers + WASM (Stockfish) load exactly like they do in the extension.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'chesstool', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const ROOT = path.join(__dirname, 'app');
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };

function createWindow() {
  const win = new BrowserWindow({
    width: 1120, height: 820, minWidth: 420, minHeight: 500,
    backgroundColor: '#1e1f22', title: 'ChessTool', autoHideMenuBar: true,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('chesstool://app/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('chesstool', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    return new Response(res.body, { status: res.status, headers: { 'content-type': type } });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
