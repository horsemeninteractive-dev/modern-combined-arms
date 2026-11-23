import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MUSIC_TRACKS,
  OUTBREAK_MENU_THEME_SRC,
  OUTBREAK_MUSIC_TRACK_ID,
} from '../src/ui/musicCatalogue';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const topLevel = html.slice(
  html.indexOf('data-menu-level="top"'),
  html.indexOf('data-menu-level="singleplayer"'),
);
const singleplayerLevel = html.slice(
  html.indexOf('data-menu-level="singleplayer"'),
  html.indexOf('data-menu-level="outbreak"'),
);
const outbreakLevel = html.slice(
  html.indexOf('data-menu-level="outbreak"'),
  html.indexOf('data-menu-level="account"'),
);
const soloPanel = html.slice(
  html.indexOf('data-menu-panel="outbreak-solo"'),
  html.indexOf('data-menu-panel="campaign"'),
);

describe('Outbreak as a top-level route', () => {
  it('sits below Singleplayer and Multiplayer, not inside Singleplayer', () => {
    const single = topLevel.indexOf('data-menu-view="singleplayer"');
    const multiplayer = topLevel.indexOf('data-menu-view="multiplayer"');
    const outbreak = topLevel.indexOf('data-menu-view="outbreak-solo"');
    expect(single).toBeGreaterThan(-1);
    expect(multiplayer).toBeGreaterThan(single);
    expect(outbreak).toBeGreaterThan(multiplayer);
    expect(singleplayerLevel).not.toContain('data-menu-view="outbreak');
  });

  it('opens its own rail level with a way back to the main menu', () => {
    expect(html).toContain('data-menu-level="outbreak"');
    expect(outbreakLevel).toContain('data-menu-back="top"');
    expect(outbreakLevel).toContain('OUTBREAK');
  });

  it('offers solo and co-op as separate routes, each with its own screen', () => {
    expect(outbreakLevel).toContain('data-menu-view="outbreak-solo"');
    expect(outbreakLevel).toContain('data-menu-view="outbreak-coop"');
    // The solo screen is the deployment panel; co-op opens the room deck.
    expect(html).toContain('data-menu-panel="outbreak-solo"');
    expect(soloPanel).not.toContain('data-outbreak-mode');
    expect(app).toMatch(/view === 'multiplayer' \|\| view === 'outbreak-coop'/);
    expect(styles).toContain(
      ".menu-screen[data-view='outbreak-coop'] .menu-view[data-menu-panel='multiplayer']",
    );
  });

  it('adds leaderboards below the solo and duo routes, on their own screen', () => {
    const solo = outbreakLevel.indexOf('data-menu-view="outbreak-solo"');
    const coop = outbreakLevel.indexOf('data-menu-view="outbreak-coop"');
    const boards = outbreakLevel.indexOf('data-menu-view="outbreak-leaderboards"');
    expect(solo).toBeGreaterThan(-1);
    expect(coop).toBeGreaterThan(solo);
    expect(boards).toBeGreaterThan(coop);
    expect(html).toContain('data-menu-panel="outbreak-leaderboards"');
    expect(app).toContain("view === 'outbreak-leaderboards'");
  });

  it('reveals a stage panel for every view in the rail', () => {
    // The deck hides every panel by default and only the per-view selector list
    // turns one back on, so a view missing from it draws an empty stage while
    // its rail item still selects. Read the views out of the markup instead of
    // listing them here: a new screen is covered the day it lands.
    const railOnly = new Set(['singleplayer']); // opens its own rail level, no stage panel
    const views = new Set(
      [...html.matchAll(/data-menu-view=["']([a-z-]+)["']/g)].map((hit) => hit[1]),
    );
    // Only a pairing inside a rule that sets `display: block` actually brings a
    // panel back: the reduced-motion list repeats the same pairings to cancel
    // their animation, so counting occurrences anywhere in the sheet would pass
    // a view that lost its real reveal rule.
    const reveals = [
      ...styles.matchAll(
        /\.menu-screen\[data-view='([a-z-]+)'\] \.menu-view\[data-menu-panel='([a-z-]+)'\]/g,
      ),
    ].map((hit) => {
      const open = styles.indexOf('{', hit.index + hit[0].length);
      const body = styles.slice(open + 1, styles.indexOf('}', open));
      return {
        selector: hit[0],
        view: hit[1],
        panel: hit[2],
        shows: /display:\s*block/.test(body),
      };
    });
    const revealed = new Set(reveals.filter((rule) => rule.shows).map((rule) => rule.view));
    const missing = [...views].filter((view) => !railOnly.has(view) && !revealed.has(view));
    expect(missing).toEqual([]);
    // A reveal naming a panel that does not exist would leave the stage blank
    // just the same, so every rule has to point at real markup.
    const panels = new Set(
      [...html.matchAll(/data-menu-panel=["']([a-z-]+)["']/g)].map((hit) => hit[1]),
    );
    const deadReveals = reveals
      .filter((rule) => !panels.has(rule.panel))
      .map((rule) => rule.selector);
    expect(deadReveals).toEqual([]);
  });

  it('shows the leaderboards panel when its view is open', () => {
    // The deck hides every panel by default and reveals the active one from a
    // per-view selector list. A view missing from that list leaves the stage
    // empty even though the rail item selects and the board itself loads.
    const reveal =
      ".menu-screen[data-view='outbreak-leaderboards'] .menu-view[data-menu-panel='outbreak-leaderboards']";
    // Both copies of the list matter: the display switch and the reduced-motion
    // override enumerate the same panels.
    expect(styles.split(reveal)).toHaveLength(3);
  });

  it('keeps both routes inside one Outbreak rail level', () => {
    expect(app).toMatch(
      /const outbreakRoute = view === 'outbreak-solo' \|\| view === 'outbreak-coop';/,
    );
    expect(app).toMatch(/outbreakRoute\s*\?\s*'outbreak'/);
  });

  it('gives the deck an Outbreak theme while either route is open', () => {
    expect(app).toContain("this.menuView === 'outbreak-solo'");
    expect(app).toContain("this.menuView === 'outbreak-coop'");
    expect(app).toContain('syncMenuTheme');
    expect(app).toContain('OUTBREAK_MENU_THEME_SRC');
    expect(app).toContain('this.audio.setMenuTheme(');
    expect(app).toContain('outbreakMenuHover');
    expect(app).toContain("pointerenter");
    // The hookup is on the menu's own theme element, not a second player.
    expect(styles).toContain("#menu-screen[data-theme='outbreak']");
    expect(styles).toContain('.menu-nav-item.outbreak-entry');
  });

  it('ships both Outbreak cues', () => {
    const battle = MUSIC_TRACKS.find((track) => track.id === OUTBREAK_MUSIC_TRACK_ID)!;
    for (const src of [battle.src, OUTBREAK_MENU_THEME_SRC]) {
      expect(existsSync(new URL(`../public${src}`, import.meta.url)), src).toBe(true);
    }
  });
});
