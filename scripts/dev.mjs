import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

if (!existsSync('.env')) {
  writeFileSync(
    '.env',
    `NODE_ENV=development\nHOST=127.0.0.1\nPORT=3001\nPUBLIC_ORIGIN=http://127.0.0.1:5173\nSETUP_PASSCODE=${randomBytes(18).toString('base64url')}\nDATA_DIR=./data\nPLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright\n`,
    { mode: 0o600 },
  );
  console.log(
    'Created .env with a private operator passcode. Open that file to use Settings → Event setup.',
  );
}
const commands = [
  [resolve('node_modules/tsx/dist/cli.mjs'), 'watch', 'server/index.ts'],
  [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
];
const children = commands.map((args) =>
  spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
children.forEach((child) => child.on('exit', (code) => stop(code ?? 0)));
