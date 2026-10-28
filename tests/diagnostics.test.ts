import { afterEach, describe, expect, it, vi } from 'vitest';
import hud from '../src/ui/hud.ts?raw';
import app from '../src/app.ts?raw';
import { copyText, diagnosticsText } from '../src/ui/diagnostics';
import { BUILD_COMMIT, BUILD_NUMBER, VERSION_LABEL } from '../src/version';

const input = {
  mapName: 'Island Assault — Kestrel Bay',
  mapId: 'island-assault',
  tick: 1234,
};

describe('diagnostics block', () => {
  it('names the build, map and tick in a pasteable order', () => {
    expect(diagnosticsText(input).split('\n')).toEqual([
      `MCA ${VERSION_LABEL}`,
      `Build ${BUILD_NUMBER} · commit ${BUILD_COMMIT}`,
      'Map Island Assault — Kestrel Bay (island-assault)',
      'Tick 1234',
    ]);
  });

  it('is stable across calls — no timestamp, seed or random data', () => {
    expect(diagnosticsText(input)).toBe(diagnosticsText(input));
  });
});

describe('clipboard copy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the async clipboard when the browser offers it', async () => {
    const writes: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async (value: string) => {
          writes.push(value);
        },
      },
    });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writes).toEqual(['hello']);
  });

  it('reports failure instead of throwing when no clipboard path exists', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('hello')).resolves.toBe(false);
  });
});

describe('pause-card wiring', () => {
  it('offers the action on both HUD compositions and routes it to the app', () => {
    expect(hud.match(/data-act="copy-diagnostics"/g)).toHaveLength(2);
    expect(hud).toContain("case 'copy-diagnostics':");
    expect(app).toContain('async copyDiagnostics()');
    expect(app).toContain('diagnosticsText({');
    expect(app).toContain('await copyText(text)');
  });
});
