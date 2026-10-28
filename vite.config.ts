import { execSync } from 'node:child_process';
import process from 'node:process';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/**
 * Release identity is compiled into the bundle instead of fetched at runtime,
 * so a deployed build can still name itself while offline. The version and
 * stage live in package.json; the build number is the repository's commit
 * count, which rises once per commit without a hand-maintained counter.
 *
 * `BUILD_NUMBER` / `BUILD_COMMIT` override the history for CI or a source
 * archive that ships without `.git`.
 */
function gitValue(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const rawBuild = process.env.BUILD_NUMBER ?? gitValue('git rev-list --count HEAD') ?? '0';
const parsedBuild = Number.parseInt(rawBuild, 10);
const buildNumber = Number.isFinite(parsedBuild) && parsedBuild >= 0 ? parsedBuild : 0;
const commit = process.env.BUILD_COMMIT ?? gitValue('git rev-parse --short HEAD') ?? 'dev';

export default defineConfig({
  define: {
    __MCA_VERSION__: JSON.stringify(pkg.version),
    __MCA_STAGE__: JSON.stringify(pkg.releaseStage.toUpperCase()),
    __MCA_BUILD__: JSON.stringify(buildNumber),
    __MCA_COMMIT__: JSON.stringify(commit),
  },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30000,
  },
});
