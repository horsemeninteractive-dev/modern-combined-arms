import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import html from '../index.html?raw';
import app from '../src/app.ts?raw';
import hud from '../src/ui/hud.ts?raw';
import {
  APP_STAGE,
  APP_VERSION,
  BUILD_COMMIT,
  BUILD_NUMBER,
  VERSION_LABEL,
  VERSION_LINE,
  buildStampLabel,
  currentBuildStamp,
  versionTitle,
} from '../src/version';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { CHANGELOG_MARKDOWN, renderChangelog } from '../src/ui/changelog';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string; releaseStage: string };
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

describe('release identity', () => {
  it('reads the semantic version and stage from package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_STAGE).toBe(pkg.releaseStage.toUpperCase());
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(APP_STAGE).toBe('BETA');
  });

  it('carries a build number and names the commit it came from', () => {
    expect(Number.isInteger(BUILD_NUMBER)).toBe(true);
    expect(BUILD_NUMBER).toBeGreaterThanOrEqual(0);
    expect(BUILD_COMMIT).toMatch(/^(?:[0-9a-f]{7,40}|dev)$/);
  });

  it('formats the menu stamp and its provenance tooltip', () => {
    expect(VERSION_LABEL).toBe(`v${pkg.version} ${pkg.releaseStage.toUpperCase()}`);
    expect(VERSION_LINE).toBe(`${VERSION_LABEL} · BUILD ${BUILD_NUMBER}`);
    expect(versionTitle()).toContain(VERSION_LINE);
    expect(versionTitle()).toContain(`commit ${BUILD_COMMIT}`);
  });
});

describe('in-game changelog', () => {
  it('renders the repository CHANGELOG.md rather than a second copy', () => {
    expect(CHANGELOG_MARKDOWN).toBe(changelog);
    expect(CHANGELOG_MARKDOWN).toContain(`## [${APP_VERSION} ${APP_STAGE}]`);
  });

  it('renders release headings, sections and bullets', () => {
    const out = renderChangelog();
    expect(out.startsWith('<div class="changelog">')).toBe(true);
    expect(out).toContain(`[${APP_VERSION} ${APP_STAGE}]`);
    expect(out).toContain('LATEST');
    expect(out).toContain('<h3>Theatre and modes</h3>');
    expect(out).toContain('<li>');
    // The modal supplies the document title; a second h1 would duplicate it.
    expect(out).not.toContain('<h1>');
  });

  it('escapes authored text and decorates only recognised syntax', () => {
    const out = renderChangelog(
      [
        '# Changelog',
        '',
        '## [9.9.9] — test',
        '',
        '### Section',
        '',
        '- **bold** and `code` <script>alert(1)</script>',
        '- see [docs](https://example.com/x)',
      ].join('\n'),
    );
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('rel="noreferrer noopener"');
    expect(out).not.toContain('<h1>');
  });

  it('keeps a wrapped bullet as one list item', () => {
    expect(renderChangelog('- first line\n  continues here')).toBe(
      '<div class="changelog"><ul><li>first line continues here</li></ul></div>',
    );
  });
});

describe('build provenance', () => {
  it('labels a saved build and admits when none was recorded', () => {
    expect(buildStampLabel(currentBuildStamp())).toBe(`${VERSION_LINE} · ${BUILD_COMMIT}`);
    expect(buildStampLabel({ version: '0.2.0', stage: 'BETA', build: 12 })).toBe('v0.2.0 BETA · BUILD 12');
    expect(buildStampLabel(undefined)).toBe('Build not recorded');
    expect(buildStampLabel({})).toBe('Build not recorded');
  });

  it('stamps a save without disturbing what the simulation restores', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    game.advance(30);
    const plain = game.toSave();
    // The simulation itself stays free of presentation provenance.
    expect(plain.build).toBeUndefined();

    const stamped = { ...plain, build: currentBuildStamp() };
    const restored = Game.fromSave(JSON.parse(JSON.stringify(stamped)));
    expect(restored.state.tick).toBe(game.state.tick);
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('surfaces the running build on the pause card, save sheet and changelog', () => {
    // Both HUD compositions carry the same stamp.
    expect(hud.match(/class="pause-build"/g)).toHaveLength(2);
    expect(hud).toContain('PAUSE_BUILD');
    expect(app).toContain('data.build = currentBuildStamp();');
    expect(app).toContain('buildStampLabel(record.data.build)');
    expect(app.match(/class="build-stamp"/g)).toHaveLength(2);
  });
});

describe('menu wiring', () => {
  it('stamps the footer and offers the changelog beside the briefing', () => {
    expect(html).toMatch(/id="menu-build"[^>]*>v0\.1\.0 BETA · BUILD/);
    expect(html).toContain('id="btn-changelog"');
    expect(html).toMatch(/id="btn-changelog"[\s\S]*id="btn-briefing"/);
  });

  it('resolves both at boot instead of relying on typed markup', () => {
    expect(app).toContain("on('btn-changelog', () => this.openChangelog())");
    expect(app).toContain('this.renderVersionStamp();');
    expect(app).toContain("document.getElementById('menu-build')");
    expect(app).toContain('stamp.textContent = `${VERSION_LINE} · IRONTIDE ENGINE`');
  });
});
