import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { defineConfig } from 'vite';

/**
 * Build only the isolated Phase 2A room Worker. The normal browser bundle is
 * untouched and never imports these modules.
 */
function rawTextPlugin() {
  return {
    name: 'mca-raw-text',
    enforce: 'pre' as const,
    load(id: string): string | null {
      const clean = id.replace(/\?.*$/, '');
      if (!id.endsWith('?raw')) return null;
      return `export default ${JSON.stringify(readFileSync(clean, 'utf8'))};`;
    },
  };
}

/**
 * Serve the tested TypeScript snapshot assembler to the staging dev page as
 * browser ESM, so the page reconstructs state with the same reducer the tests
 * and the soak harness use instead of a second implementation.
 */
function assemblerSourcePlugin() {
  const virtualId = 'virtual:mca-assembler';
  return {
    name: 'mca-assembler-source',
    resolveId(source: string): string | null {
      return source === virtualId ? virtualId : null;
    },
    load(id: string): string | null {
      if (id !== virtualId) return null;
      const source = readFileSync('src/multiplayer/snapshotAssembler.ts', 'utf8');
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          removeComments: false,
        },
        fileName: 'snapshotAssembler.ts',
      });
      return `export default ${JSON.stringify(output.outputText)};`;
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [assemblerSourcePlugin(), rawTextPlugin()],
  build: {
    outDir: 'dist-mp-room',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/multiplayer/roomWorker.ts',
      formats: ['es'],
      fileName: () => 'roomWorker.js',
    },
  },
});
