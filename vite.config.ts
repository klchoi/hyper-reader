// The page is built from src/ into one file that holds everything it needs (its script, its
// styles, its libraries), so it opens from the disk as it is: `npm run build` writes it to
// dist/ and puts it in place as hyper-reader.html. `npm run dev` serves src/ as it changes, at
// any path of the page (`/books/<id>`), and leaves the books to the server: `npm start`, or the
// one at API (http://api:8080 in compose.yaml). POLL=1 watches the files by looking, where a
// change to them is not told (some mounts into a container).
const api = process.env.API ?? 'http://127.0.0.1:8080';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { ripple } from '@ripple-ts/vite-plugin';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [ripple({ excludeRippleExternalModules: true }), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'esnext',
    // the page is kept in git as it is built: one that reads as written diffs as written
    minify: false,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/index.html') },
  },
  server: {
    // the server is asked by the name the page was (`localhost:5173`): it answers only this
    // computer's names, and a change only from the page of the name it is asked by
    proxy: { '/api': { target: api, changeOrigin: false } },
    watch: process.env.POLL ? { usePolling: true, interval: 300 } : undefined,
  },
});
