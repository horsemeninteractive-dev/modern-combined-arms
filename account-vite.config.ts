import { defineConfig } from 'vite';

/**
 * Build only the account Worker. The browser bundle never imports these
 * modules; this output is uploaded by `wrangler deploy` from
 * `account-wrangler*.jsonc`.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-account',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/accounts/worker.ts',
      formats: ['es'],
      fileName: () => 'accountWorker.js',
    },
  },
});
