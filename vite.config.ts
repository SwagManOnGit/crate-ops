import { defineConfig } from 'vite';

// base './' => relative asset paths, required by YouTube Playables (no absolute paths).
export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    assetsInlineLimit: 4096,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: { port: 5176, strictPort: true },
});
