import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: { chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
  // crxjs uses a websocket for HMR of the content script
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
