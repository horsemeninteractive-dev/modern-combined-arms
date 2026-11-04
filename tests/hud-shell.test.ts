import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/** The rail, from its opening element to the `</aside>` that closes it. */
function railMarkup(): string {
  const start = hud.indexOf('<aside class="hud-rail"');
  const end = hud.indexOf('</aside>', start);
  expect(start).toBeGreaterThan(-1);
  return hud.slice(start, end);
}

describe('command rail', () => {
  it('hangs the power gauge off the scrolling column', () => {
    const rail = railMarkup();
    const body = rail.indexOf('class="rail-body"');
    const gauge = rail.indexOf('class="rail-power"');
    expect(body).toBeGreaterThan(-1);
    // The gauge is a sibling of the column, not a row inside it: a block inside
    // the scroll container would slide away with the content it measures.
    expect(gauge).toBeGreaterThan(body);
    expect(rail).toContain('data-power-fill="v"');
    expect(styles).toMatch(/\.rail-body \{[^}]*overflow-y: auto/);
    expect(styles).toMatch(/\.rail-power \{[^}]*flex: 0 0 var\(--power-w\)/);
  });

  it('opens a grid readout from the gauge and turns BASE to power structures', () => {
    const rail = railMarkup();
    // The gauge is the grid's control, not only its display.
    expect(rail).toContain('data-power-open');
    expect(rail).toContain('data-act="power"');
    expect(rail).toContain('tabindex="0"');
    expect(rail).toContain('aria-describedby="power-readout"');
    // The readout itself hangs outside the clipped rail, so it is not in the
    // aside the helper slices out; the HUD source still carries all of it.
    expect(hud).toContain('id="power-readout"');
    expect(hud).toContain('data-pr-sources');
    expect(hud).toContain('data-pr-consumers');
    expect(hud).toContain('focusGridStructures');
    expect(styles).toContain('.power-readout {');
    expect(styles).toContain('.build-card.grid-focus');
  });

  it('makes the briefing an icon in the 2x3 battle control pad', () => {
    const rail = railMarkup();
    const actions = rail.slice(rail.indexOf('class="rail-actions"'));
    expect(actions).toContain('id="rail-objective-btn"');
    expect(actions).toContain("icon('target')");
    expect(rail).not.toContain('>BRIEFING<');
    expect(styles).toMatch(/\.rail-actions \{[^}]*grid-template-rows: repeat\(3/);
    expect(styles).toMatch(/\.rail-actions \.rail-objective \{[^}]*grid-column: 1 \/ -1/);
  });

  it('names the coalition at the head and the nation under its flag', () => {
    const rail = railMarkup();
    const head = rail.slice(rail.indexOf('rail-theatre'), rail.indexOf('rail-identity'));
    expect(head).toContain('frontLabel');
    const identity = rail.slice(rail.indexOf('rail-identity'));
    expect(identity).toContain('rail-nation');
    expect(identity).toContain('nationLabel');
    expect(styles).toContain('.rail-nation {');
  });
});

describe('hud entry', () => {
  it('stages the shells in from their own edges', () => {
    expect(styles).toMatch(/@keyframes hud-panel-left \{ from \{[^}]*translateX\(-101%\)/);
    expect(styles).toMatch(/@keyframes hud-panel-right \{ from \{[^}]*translateX\(101%\)/);
    expect(styles).toMatch(/@keyframes hud-panel-up \{ from \{[^}]*translateY\(101%\)/);
    expect(styles).toMatch(/\.hud\.hud-enter \.hud-rail \{ animation: hud-panel-left/);
    expect(styles).toMatch(/\.hud\.hud-enter \.production-sidebar \{ animation: hud-panel-right/);
    expect(styles).toMatch(/\.hud\.hud-enter \.battle-console/);
    // The console arrives after the sidebars, and its contents after it.
    expect(styles).toMatch(/\.hud-enter \.console-actions \{ animation-delay: 4\d\dms; \}/);
    expect(styles).toMatch(/\.hud-enter \.selection-panel \{ animation-delay: 4\d\dms; \}/);
  });

  it('plays the same move backwards before hiding the chrome', () => {
    expect(styles).toMatch(/\.hud\.hud-exit \.hud-rail \{ animation: hud-panel-left[^}]*reverse/);
    expect(styles).toMatch(/\.hud\.hud-exit > :not\(\.hud-toggle\) \{ pointer-events: none; \}/);
    expect(styles).toMatch(/\.hud\.hud-hidden > :not\(\.hud-toggle\) \{ display: none !important; \}/);
    // Hiding is scripted: the exit finishes first, then the chrome is removed.
    const visibility = hud.slice(hud.indexOf('private applyHudVisibility'));
    expect(visibility).toContain("hud.classList.add('hud-exit')");
    expect(visibility).toContain("hud.classList.add('hud-hidden')");
    expect(visibility).toMatch(/setTimeout\([\s\S]*?300\)/);
  });

  it('replays the entrance when the chrome is brought back', () => {
    const visibility = hud.slice(hud.indexOf('private applyHudVisibility'));
    expect(visibility).toContain('void hud.offsetWidth');
    expect(visibility).toContain("hud.classList.add('hud-enter')");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.hud\.hud-enter \.hud-rail/);
  });
});

describe('menu backdrop sky', () => {
  it('gives the attract battle its own day cycle and weather front', () => {
    const start = app.slice(app.indexOf('private startAttractMatch'));
    const body = start.slice(0, start.indexOf('private stopAttract'));
    expect(body).toContain('scenario.settings.startHour =');
    expect(body).toContain('scenario.settings.dayLengthMinutes = ATTRACT_DAY_MINUTES');
    expect(body).toContain('scenario.settings.weather = ATTRACT_WEATHER');
    // The backdrop's cycle is compressed, not the game's default four hours.
    expect(app).toMatch(/const ATTRACT_DAY_MINUTES = \d+;/);
    expect(app).toMatch(/const ATTRACT_START_HOURS = \[/);
    expect(app).toMatch(/const ATTRACT_WEATHER: ReadonlyArray<Scenario\['settings'\]\['weather'\]> = \[/);
  });
});
