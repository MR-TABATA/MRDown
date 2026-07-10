// Serves the real app (root index.html + src/main.ts) with every `@tauri-apps/*`
// import redirected to the in-memory mocks, so the UI runs in a plain browser.
//
//   npx vite -c demo/vite.config.ts        # http://localhost:1421
//
// `src/` is never modified. If a new Tauri API is imported by the app, the dev
// server fails to resolve it here — which is the point: the demo can't silently
// drift away from what the app actually needs.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = (name: string) => path.resolve(here, 'mock', name);

export default defineConfig({
  root: path.resolve(here, '..'),
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: {
      '@tauri-apps/api/core': mock('core.ts'),
      '@tauri-apps/api/event': mock('event.ts'),
      '@tauri-apps/api/webview': mock('webview.ts'),
      '@tauri-apps/api/window': mock('window.ts'),
      '@tauri-apps/api/path': mock('path.ts'),
      '@tauri-apps/plugin-dialog': mock('dialog.ts'),
      '@tauri-apps/plugin-opener': mock('opener.ts'),
    },
  },
});
