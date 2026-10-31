import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import app from '../src/app.ts?raw';
import overlay from '../src/ui/overlay.ts?raw';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import {
  TUTORIAL_ASSEMBLY_POINT,
  TUTORIAL_ASSEMBLY_TILE,
  TUTORIAL_BUILD_SITE,
  TUTORIAL_SCENARIO_ID,
  TUTORIAL_TARGET_TILE,
  createTutorialScenario,
} from '../src/data/tutorial';
import { Game } from '../src/sim/game';
import { reachableFrom, validateScenario, canLaunch } from '../src/sim/scenario';
import { TILE_SIZE } from '../src/sim/constants';
import { tileIndex } from '../src/sim/terrain';
import { WEAPONS } from '../src/data/weapons';

describe('training-grounds mission', () => {
  it('is a legal standalone battle', () => {
    const scenario = createTutorialScenario();
    const errors = validateScenario(scenario).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
    expect(canLaunch(scenario)).toBe(true);
    expect(scenario.meta.id).toBe(TUTORIAL_SCENARIO_ID);
    expect(scenario.meta.name).toBe('Training Grounds');
    expect(scenario.settings.fog).toBe(false);
    expect(scenario.settings.startingMats).toBeGreaterThanOrEqual(
      BUILDINGS.barracks.cost.mats + 130,
    );
  });

  it('stages one engineer, a starter squad and a single aggressor', () => {
    const scenario = createTutorialScenario();
    const playerUnits = scenario.units.filter((unit) => unit.owner === 0);
    const enemyUnits = scenario.units.filter((unit) => unit.owner === 1);
    expect(playerUnits.filter((unit) => unit.defId === 'engineer')).toHaveLength(1);
    expect(playerUnits.filter((unit) => unit.defId === 'rifle')).toHaveLength(2);
    expect(enemyUnits).toEqual([
      { defId: 'engineer', owner: 1, x: TUTORIAL_TARGET_TILE.x, z: TUTORIAL_TARGET_TILE.z },
    ]);
    expect(scenario.structures.some((structure) => structure.owner === 0 && buildingFamily(structure.defId) === 'barracks')).toBe(false);
    expect(scenario.structures.some((structure) => structure.owner === 1 && structure.defId === 'commandPost')).toBe(true);
  });

  it('offers a valid barracks pad and a reachable live-fire target', () => {
    const scenario = createTutorialScenario();
    const game = new Game(createTutorialScenario(), { enableAI: false });
    const barracksId = game.rosterFor(0).buildings.find((id) => buildingFamily(id) === 'barracks');
    expect(barracksId).toBeDefined();
    const placement = game.placementStatus(0, barracksId!, TUTORIAL_BUILD_SITE.x, TUTORIAL_BUILD_SITE.z);
    expect(placement.ok, placement.reason).toBe(true);

    const reach = reachableFrom(
      scenario,
      [{ x: scenario.players[0].startX, z: scenario.players[0].startZ }],
      'foot',
    );
    expect(reach[tileIndex(scenario.width, TUTORIAL_TARGET_TILE.x, TUTORIAL_TARGET_TILE.z)]).toBe(1);
  });

  it('places the aggressor just beyond the squad’s automatic range', () => {
    const distanceTiles = Math.hypot(
      TUTORIAL_TARGET_TILE.x - TUTORIAL_ASSEMBLY_TILE.x,
      TUTORIAL_TARGET_TILE.z - TUTORIAL_ASSEMBLY_TILE.z,
    );
    // The player must give the attack order: at the assembly point the target is
    // visible but outside rifle range, so the lesson cannot finish itself. The
    // simulation grants one tile of auto-acquire tolerance, so clear that too.
    expect(distanceTiles).toBeGreaterThan(WEAPONS.rifle.range + 1);
    expect(distanceTiles).toBeLessThanOrEqual(WEAPONS.rifle.range + 4);
    // The walk itself should be long enough to read as movement, not a twitch.
    expect(TUTORIAL_ASSEMBLY_TILE.x - TUTORIAL_BUILD_SITE.x).toBeGreaterThan(2);
  });

  it('does not auto-engage the aggressor from the assembly point', () => {
    const game = new Game(createTutorialScenario(), { enableAI: false });
    const rifles = game
      .entitiesOf(0, 'unit')
      .filter((unit) => unit.defId === 'rifle')
      .map((unit) => unit.id);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: rifles,
      x: TUTORIAL_ASSEMBLY_POINT.x,
      z: TUTORIAL_ASSEMBLY_POINT.z,
    });
    game.advance(800);
    const target = game.state.entities.find(
      (entity) => entity.owner === 1 && entity.defId === 'engineer',
    );
    expect(target?.hp).toBe(target?.maxHp);

    // The ordered attack is still the completion path: two riflemen can finish
    // the isolated engineer once the squad is told to engage.
    expect(target).toBeDefined();
    const targetId = target!.id;
    game.enqueueCommand({ type: 'attack', team: 0, ids: rifles, targetId });
    game.advance(3000);
    expect(game.getEntity(targetId)?.hp ?? 0).toBeLessThanOrEqual(0);
  });

  it('keeps the lane overlay presentation-only', () => {
    // The marker is drawn from the director and never appended to state.
    expect(overlay).toContain('drawTutorialMarker');
    expect(overlay).toContain('app.tutorial?.marker()');
    expect(app).toContain('enableAI: !isTutorial');
    expect(app).toContain('new TutorialDirector(this)');
  });

  it('is reachable from the singleplayer rail', () => {
    expect(html).toContain('id="btn-tutorial"');
    expect(html).toContain('id="tutorial-panel"');
    expect(html).toContain('id="tutorial-progress-label"');
    expect(app).toContain("on('btn-tutorial'");
  });

  it('places the lane inside the map footprint', () => {
    const scenario = createTutorialScenario();
    expect(TUTORIAL_BUILD_SITE.x + 3).toBeLessThanOrEqual(scenario.width);
    expect(TUTORIAL_BUILD_SITE.z + 3).toBeLessThanOrEqual(scenario.height);
    expect(TUTORIAL_TARGET_TILE.x).toBeGreaterThan(TUTORIAL_ASSEMBLY_TILE.x);
    expect(TUTORIAL_ASSEMBLY_TILE.x * TILE_SIZE).toBeGreaterThan(0);
  });
});
