import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

  it('fills the top panel with the waving nation flag behind a static crest', () => {
    const rail = railMarkup();
    // The side a command belongs to is read from the crest's colour, not from a
    // word: neither the coalition name, the nation name nor a colour swatch is
    // printed in the rail any more.
    expect(rail).not.toContain('rail-theatre');
    expect(rail).not.toContain('rail-wordmark');
    expect(rail).not.toContain('rail-nation');
    expect(rail).not.toContain('resource-swatch');
    const identity = rail.slice(rail.indexOf('rail-identity'));
    expect(identity).toContain('rail-flag');
    expect(identity).toContain('rail-crest');
    expect(identity.indexOf('rail-flag')).toBeLessThan(identity.indexOf('rail-crest'));
    expect(identity).toContain('nationLabel');
    // The image fills the panel and the crest is a sibling, so the crest stays
    // still while the cloth is displaced by the inline SVG filter.
    expect(styles).toMatch(/\.rail-flag \{[^}]*width: 100%[^}]*height: 100%[^}]*object-fit: cover/);
    expect(styles).toContain("filter: url('#flag-wave')");
    expect(styles).toContain('.flag-wave-defs {');
    expect(html).toContain('id="flag-wave"');
    expect(html).toContain('feDisplacementMap');
    // The crest is a mask tinted by the coalition colour, so one asset serves
    // every faction rather than a blue and a red copy.
    expect(styles).toMatch(/\.rail-crest i \{[^}]*background: var\(--front/);
    expect(styles).toMatch(/\.rail-crest i \{[^}]*mask: url\('\/insignia-crest\.svg'\)/);
  });
});

describe('touch safe areas', () => {
  it('pads the power strip with the inset on the edge it belongs to', () => {
    // The strip is full-bleed, so the safe-area padding is the only thing that
    // keeps the label out from under a landscape notch.
    expect(styles).toMatch(
      /\.mobile-power-strip \{[^}]*padding: 0 calc\(8px \+ env\(safe-area-inset-right, 0px\)\) 0 calc\(8px \+ env\(safe-area-inset-left, 0px\)\)/,
    );
    expect(styles).toMatch(/\.layout-mobile \.mobile-command-row \{[^}]*padding-right: 46px/);
    expect(styles).toMatch(/\.layout-mobile \.hud-toggle \{[^}]*right: env\(safe-area-inset-right, 0px\)[^}]*bottom: env\(safe-area-inset-bottom, 0px\)/);
  });

  it('fits the longest production label inside the narrow touch rail', () => {
    // RESEARCH and STRATEGY are eight characters in a 60px tab, so the touch
    // label shrinks below the desktop scale rather than truncating the word.
    expect(styles).toMatch(
      /\.layout-mobile \.prod-tab \.rail-label \{[^}]*font-size: 10px[^}]*letter-spacing: 0;/,
    );
    expect(styles).toMatch(/\.layout-mobile \.prod-tab \{[^}]*padding: 3px 0;/);
  });

  it('centres the map dock with its own insets, not a transform', () => {
    // The shared entrance animation owns `transform`; a translate-based centre
    // was replaced mid-animation and left the dock hanging off the right edge.
    expect(styles).toMatch(/\.layout-mobile \.map-dock \{[^}]*margin: 0 auto; transform: none/);
    expect(styles).toMatch(/\.hud\.layout-mobile \.map-dock \{ animation: none; \}/);
  });

  it('keeps the production sheet open for tab changes and repeat purchases', () => {
    expect(hud).toContain('private showPanel(');
    const tabs = hud.slice(hud.indexOf("const tabEl = target?.closest"), hud.indexOf('private bindMinimap'));
    expect(tabs).toContain("this.showPanel('production')");
    const produce = hud.slice(
      hud.indexOf("querySelectorAll<HTMLButtonElement>('[data-produce]')"),
      hud.indexOf('.unit-card.reorderable'),
    );
    expect(produce).toContain('this.renderProduction(true)');
    expect(produce).not.toContain("setPanel('none')");
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

  it('puts the chrome away for a cinematic and gives it back afterwards', () => {
    // A scene must not overwrite the commander's own HUD choice.
    expect(hud).toContain('private cinemaHidden = false;');
    expect(hud).toContain('get chromeHidden()');
    expect(hud).toContain('return this.hudHidden || this.cinemaHidden;');
    const start = hud.indexOf('setCinemaHidden(hidden: boolean)');
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, start + 420);
    // Gone without a slide on the first frame of the scene, back with the
    // entrance choreography once it ends.
    expect(body).toContain('this.applyHudVisibility(!hidden)');
    // A HUD that is already off screen is not replayed into view by the exit.
    expect(hud).toMatch(/!animate \|\| hud\.classList\.contains\('hud-hidden'\)/);
    // The player's toggle still reports the player's choice.
    expect(hud).toContain("button.setAttribute('aria-pressed', String(this.hudHidden));");
    // Both ends of a sequence drive it.
    expect(app).toContain('this.hud.setCinemaHidden(true)');
    expect(app).toContain('this.hud.setCinemaHidden(false)');
  });

  it('puts the chrome away before an opening scene builds its shell', () => {
    // A launch builds the interface and starts the scene in one task, but the
    // hide has to land before the mount: the entrance is what would otherwise
    // be painted for a frame and then yanked away.
    const launch = app.slice(app.indexOf('const openingCinematic'), app.indexOf('this.audio.announce(\'battlefieldEstablished\')'));
    const hide = launch.indexOf('this.hud.setCinemaHidden(true)');
    const mount = launch.indexOf('this.hud.mount(game)');
    const play = launch.indexOf('this.playCinematic(');
    expect(hide).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(hide);
    expect(play).toBeGreaterThan(mount);
    // A scene that does not start hands the interface straight back.
    expect(launch).toContain('if (!started) this.hud.setCinemaHidden(false)');
    // Leaving the battlefield clears the scene's hold on the shell.
    const unmount = hud.slice(hud.indexOf('unmount(): void'));
    expect(unmount.slice(0, 600)).toContain('this.cinemaHidden = false');
  });

  it('replays the entrance when the chrome is brought back', () => {
    const visibility = hud.slice(hud.indexOf('private applyHudVisibility'));
    expect(visibility).toContain('void hud.offsetWidth');
    expect(visibility).toContain("hud.classList.add('hud-enter')");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.hud\.hud-enter \.hud-rail/);
  });
});

describe('overlay lifecycle across a layout rebuild', () => {
  it('restores the held pause and verdict instead of leaving the new shell empty', () => {
    const shell = hud.slice(hud.indexOf('private renderShell'), hud.indexOf('private markup'));
    // Both overlays are app state, but the rebuilt markup starts them hidden.
    expect(shell).toContain('this.syncPauseState(true);');
    expect(shell).toContain('this.showEnd(result, false);');
    expect(hud).toContain('private endResult: VictoryState | null = null;');
    expect(hud).toContain('this.endResult = result;');
    // Rebuilding the card must not replay the verdict sting.
    expect(hud).toContain('if (announce) this.app.audio.play');
    // A fresh battle starts with no remembered verdict.
    const mount = hud.slice(hud.indexOf('mount(game: Game): void'), hud.indexOf('unmount(): void'));
    expect(mount).toContain('this.endResult = null;');
  });
});

describe('selection band', () => {
  it('never scrolls: every row fits the fixed band', () => {
    expect(styles).toMatch(/\.selection-body \{[^}]*overflow: hidden/);
    // Values are one line each, label left and figure right, so five of them
    // are three short rows rather than five stacked cells.
    expect(styles).toMatch(/\.layout-desktop \.selection-body \.stat \{[^}]*display: flex/);
    expect(styles).toMatch(/\.layout-desktop \.selection-body \.stat-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('puts sell, module and ability controls in square icon buttons', () => {
    // Cost, effect and hotkey are the tooltip's job; the button is an icon.
    expect(hud).toContain('class="sel-square sell-btn danger"');
    expect(hud).toContain('class="sel-square sell-btn dismantling"');
    expect(hud).toContain('class="sel-square module-btn');
    expect(hud).toContain('class="sel-square ability-btn');
    expect(hud).toContain("icon('sell', 'square-icon')");
    expect(hud).toContain('${action.description}');
    expect(styles).toMatch(/\.sel-square \{[^}]*width: calc\(28px \* var\(--ui-scale\)\)/);
    expect(styles).toMatch(/\.sel-square \.square-badge \{/);
  });

  it('puts the integrity bar under the identity and the squares at the far right', () => {
    const start = hud.indexOf('const e = inspected ?? entities[0];');
    const single = hud.slice(start, hud.indexOf('<div class="sel-actions">', start));
    // The bar belongs to the identity it describes…
    const primary = single.slice(single.indexOf('<div class="sel-primary">'), single.indexOf('<div class="sel-stats">'));
    expect(primary).toContain('class="sel-vitals"');
    expect(primary).not.toContain('sel-squares');
    // …and the square commands are their own group, anchored to the last column.
    expect(single).toContain('<div class="sel-squares">');
    expect(styles).toMatch(/\.layout-desktop \.selection-body \.sel-squares \{[^}]*grid-column: 4/);
    expect(styles).toMatch(/\.sel-squares \{ display: flex/);
    expect(styles).toMatch(/\.sel-squares > \* \{ display: contents; \}/);
    expect(styles).toMatch(/\.sel-squares \.sel-square \{ width: calc\(40px \* var\(--ui-scale\)\)/);
  });

  it('asks before a sale starts dismantling a structure', () => {
    const start = hud.indexOf('private bindSellButtons');
    const bind = hud.slice(start, hud.indexOf('private bindStanceButtons', start));
    // The first click only arms the sale; the command leaves on the second.
    expect(bind.indexOf('this.armSale(id)')).toBeGreaterThan(-1);
    expect(bind.indexOf('this.armSale(id)')).toBeLessThan(bind.indexOf('this.app.sellBuilding(id)'));
    // A double-click cannot arm and confirm in one motion.
    expect(bind).toContain('SALE_CONFIRM_GRACE_MS');
    // There is a way back out that dispatches nothing.
    expect(hud).toContain('data-sell-cancel');
    expect(bind).toContain('this.disarmSale();\n        this.renderSelection(true);');
    // An armed sale does not survive the structure leaving the selection.
    const selection = hud.slice(hud.indexOf('private renderSelection'), hud.indexOf('private renderRoster'));
    expect(selection).toContain('this.disarmSale();');
    expect(styles).toMatch(/\.sell-orders\.confirm \.sell-btn\.cancel \{/);
  });
});

describe('interface sound', () => {
  it('clicks from one delegated cue on every control in the shell', () => {
    const start = hud.indexOf('private handleHudClick');
    const click = hud.slice(start, hud.indexOf('private bindMinimap', start));
    // The cue lands before dispatch, so even a control that only re-renders
    // something and reaches no command handler still answers the click.
    expect(click.indexOf('this.clickCue(target);')).toBeGreaterThan(-1);
    expect(click.indexOf('this.clickCue(target);')).toBeLessThan(click.indexOf("dataset.act ?? ''"));
    const cue = hud.slice(hud.indexOf('private clickCue'), start);
    expect(cue).toContain("'button, [role=\"button\"]'");
    // A control that cannot act says so instead of pretending to accept.
    expect(cue).toContain("getAttribute('aria-disabled') === 'true'");
    expect(cue).toContain("this.app.audio.play('denied')");
    expect(cue).toContain('dataset.sellCancel');
    expect(cue).toContain("this.app.audio.play('cancel')");
    expect(cue).toContain("this.app.audio.play('ui')");
  });

  it('gives the battlefield a bed of engines, rotors and working structures', () => {
    // The app only describes the world; the plan decides who is audible.
    expect(app).toContain('ambiencePlan(this.ambienceCandidates()');
    expect(app).toContain('this.audio.updateAmbience(');
    expect(app).toContain('unitAmbience({');
    expect(app).toContain('structureAmbience(def)');
    // Positional: the camera's projection decides where a source sits in the mix,
    // and the framing decides how loud the bed is as a whole.
    expect(app).toContain('camera.worldToScreen(x, 0, z)');
    expect(app).toContain('framingGain(this.renderer.camera.zoom)');
    // Drive class and weight are what keep a jeep from sounding like a tank.
    expect(app).toContain('moveClass: def.moveClass');
    expect(app).toContain('armour: def.armour');
    // Unseen hulls must not give themselves away by their engines.
    const candidates = app.slice(app.indexOf('private ambienceCandidates'));
    expect(candidates).toContain('game.isVisibleTo(this.localPlayerId, e.id)');
    // A hull on turnaround gives its voice to the kit beside it: the pump and a
    // beacon chirp on the nearest working apron, not an idling aircraft engine.
    expect(candidates).toContain('isServicingAircraft(e)');
    expect(candidates).toContain('serviceKitAmbience({ servicing: true })');
    expect(app).toContain("this.audio.play('serviceBeacon'");
    expect(app).toContain('SERVICE_BEACON_CHIRP_SECONDS');
    const audio = readFileSync(new URL('../src/ui/audio.ts', import.meta.url), 'utf8');
    expect(audio).toMatch(/rotor: \{[^}]*filterType: 'bandpass'/);
    expect(audio).toContain('this.bedBus.connect(this.ambient)');
    expect(audio).toContain('this.releaseBed();');
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
