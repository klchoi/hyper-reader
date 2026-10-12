// The page is built from src/ into one file that holds everything it needs (its script, its
// styles, its libraries), so it opens from the disk as it is: `npm run build` writes it to
// dist/ and puts it in place as hyper-reader.html. `npm run dev` serves src/ as it changes,
// and leaves the books to the server (`npm start`).
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
    rollupOptions: { input: resolve(import.meta.dirname, 'src/hyper-reader.html') },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
});
