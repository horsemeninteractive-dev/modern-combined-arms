/**
 * Garrisonable buildings and the fog of war.
 *
 * The authored civilian strongpoints (tenements, warehouses, chapels and so on)
 * are ordinary structures on the map: neutral, indestructible-by-default and
 * worth fighting for. They must not be the one exception that is charted for
 * free — an ungarrisoned tenement in the fog is a reason to send a scout, not a
 * free landmark. These fixtures hold that line at the simulation boundary, and
 * the renderer fixtures hold the presentation half: a charted building is drawn
 * as cold memory, never in full team colour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { scenariosForMode } from '../src/data/scenarioCatalog';
import { BUILDINGS } from '../src/data/buildings';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('garrisonable buildings in the fog', () => {
  it('charts no garrisonable shelter for free on any map', () => {
    let checked = 0;
    for (const entry of scenariosForMode('skirmish')) {
      const scenario = entry.create();
      scenario.settings.fog = true;
      const game = new Game(scenario, { enableAI: false });
      const team = game.teamOf(game.localPlayerId);
      for (const entity of game.state.entities) {
        if (entity.kind !== 'building') continue;
        if (!BUILDINGS[entity.defId]?.garrison) continue;
        checked++;
        // At tick 0 nothing has been seen and then lost, so a shelter may only
        // be visible (a friendly unit is standing within sight of it) or hidden.
        // A shelter that arrives *remembered* was charted for free, and would
        // draw as a dim silhouette over ground the team has never looked at.
        expect(game.visionStateOf(team, entity.id)).not.toBe('remembered');
      }
    }
    // The fixtures are only meaningful if the maps actually author shelters.
    expect(checked).toBeGreaterThan(8);
  });

  it('draws a charted shelter as cold memory rather than a visible building', () => {
    const battle = rendererSource.slice(
      rendererSource.indexOf('private drawBattleEntities'),
      rendererSource.indexOf('private drawEntityMesh'),
    );
    // The gate itself: hidden is skipped outright.
    expect(battle).toContain("if (vision === 'hidden') continue;");
    // And the memory treatment: dimmer than a seen building, and desaturated,
    // so a tenement cannot pass for something the team currently has eyes on.
    expect(battle).toContain('const alpha = remembered ? 0.46 : liveAlpha;');
    expect(battle).toContain('remembered ? 0.52 : 1');
    expect(battle).toContain('remembered ? 0.6 : 1');
    expect(battle).toContain('remembered ? 0.66 : 1');
  });

  it('never lights the windows of a shelter the team has only charted', () => {
    // A lit facade is an advertisement: charted glass stays dark until the
    // building is seen again.
    const glow = rendererSource.slice(
      rendererSource.indexOf('private buildingWindowGlow'),
      rendererSource.indexOf('private buildLightInstances'),
    );
    expect(glow).toContain('remembered');
    expect(rendererSource).toContain("visible: (e) => game.visionStateOf(team, e.id) === 'visible'");
  });
});
