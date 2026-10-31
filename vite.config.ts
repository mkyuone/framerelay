import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function offlineShell(): Plugin {
  return {
    name: 'framerelay-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicAssets = [
        '/manifest.webmanifest',
        '/icons/app-icon.svg',
        '/icons/icon-32.png',
        '/icons/icon-180.png',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ];
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/'))
        .map((file) => `/${file}`);
      const files = ['/', ...publicAssets, ...assets];
      const version = createHash('sha256')
        .update(JSON.stringify(files))
        .update(readFileSync('index.html'))
        .update(readFileSync('public/manifest.webmanifest'))
        .update(readFileSync('public/icons/app-icon.svg'))
        .digest('hex')
        .slice(0, 16);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const CACHE = 'framerelay-shell-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('framerelay-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => response.ok ? response : caches.open(CACHE).then(cache => cache.match('/')).then(cached => cached || response)).catch(() => caches.open(CACHE).then(cache => cache.match('/'))));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { target: 'es2022' },
});
