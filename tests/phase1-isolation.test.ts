import { readFileSync } from 'node:fs';
import { MULTIPLAYER_FEATURE } from '../src/multiplayer/featureFlag';

describe('Phase 1 production isolation', () => {
  it('ships online 1v1 without room discovery, accounts or server code in the app bundle', () => {
    // Online play is hosted, so the flag is on; discovery and accounts are not,
    // and the authoritative room modules stay server-side either way.
    expect(MULTIPLAYER_FEATURE.enabled).toBe(true);
    expect(MULTIPLAYER_FEATURE.roomDiscovery).toBe(false);
    expect(MULTIPLAYER_FEATURE.accountLinking).toBe(false);

    for (const file of ['../src/main.ts', '../src/app.ts', '../vite.config.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/multiplayer\/(commandGate|projection|reservation|roomSnapshot)/);
      expect(source).not.toMatch(/MULTIPLAYER_FEATURE/);
    }
  });
});
