// Assembles the shared app into the extension and the desktop shell.
//   app/vendor      <- chess.js (ESM) + Stockfish 18 lite single-threaded WASM
//   extension/app   <- app/
//   desktop/app     <- app/
//   dist/chesstool-extension.zip
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(root, ...a);

const vendor = p('app', 'vendor');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
copyFileSync(p('node_modules/chess.js/dist/esm/chess.js'), join(vendor, 'chess.js'));
copyFileSync(p('node_modules/stockfish/bin/stockfish-18-lite-single.js'), join(vendor, 'stockfish.js'));
copyFileSync(p('node_modules/stockfish/bin/stockfish-18-lite-single.wasm'), join(vendor, 'stockfish.wasm'));
copyFileSync(p('node_modules/stockfish/Copying.txt'), join(vendor, 'STOCKFISH-LICENSE.txt'));
copyFileSync(p('assets/icon.png'), p('app', 'icon.png'));

for (const target of ['extension', 'desktop']) {
  const dest = p(target, 'app');
  rmSync(dest, { recursive: true, force: true });
  cpSync(p('app'), dest, { recursive: true });
}
copyFileSync(p('assets/icon.png'), p('desktop', 'icon.png'));

mkdirSync(p('dist'), { recursive: true });
const zip = p('dist', 'chesstool-extension.zip');
rmSync(zip, { force: true });
try {
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${p('extension')}\\*' -DestinationPath '${zip}'"`);
  } else {
    execSync(`zip -qr "${zip}" .`, { cwd: p('extension') });
  }
  console.log('Built dist/chesstool-extension.zip');
} catch {
  console.log('(zip not available — load the extension/ folder unpacked instead)');
}
console.log('Extension ready in extension/  ·  desktop app ready in desktop/');
if (!existsSync(p('desktop', 'node_modules'))) console.log('Next: npm run desktop  (or npm run dist:win for the .exe)');
