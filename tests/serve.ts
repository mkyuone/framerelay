import 'dotenv/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server/app.ts';
import { startRenderer } from '../server/renderer.ts';

const root = await mkdtemp(join(tmpdir(), 'framerelay-browser-'));
const { app, store } = await createApp({
  root,
  setupPasscode: 'browser-test-operator-passcode',
  origin: 'http://127.0.0.1:3401',
});
await app.listen({ host: '127.0.0.1', port: 3401 });
const stop = startRenderer(store, { port: 3401, origin: 'http://127.0.0.1:3401' });
let stopped = false;
async function close() {
  if (stopped) return;
  stopped = true;
  await stop();
  await app.close();
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test directory');
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
