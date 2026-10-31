import 'dotenv/config';
import { createApp } from './app.ts';
import { startRenderer } from './renderer.ts';

const passcode = process.env.SETUP_PASSCODE;
if (!passcode || passcode.length < 12)
  throw new Error(
    'Set SETUP_PASSCODE (at least 12 characters), or use npm run dev for local setup.',
  );
const port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? '127.0.0.1';
const { app, store } = await createApp({
  root: process.env.DATA_DIR,
  setupPasscode: passcode,
  origin: process.env.PUBLIC_ORIGIN,
  production: process.env.NODE_ENV === 'production',
});
await app.listen({ port, host });
const stopRenderer = startRenderer(store, {
  port,
  origin: process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
});
console.log(`FrameRelay server listening on ${host}:${port}`);
async function shutdown() {
  await stopRenderer();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
