import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import {
  BUILDABLE_BY_PLAYER,
  BUILDINGS,
  buildingFamily,
  buildingRequirements,
} from '../src/data/buildings';
import type { Scenario } from '../src/sim/scenario';

function gameWith(structures: Scenario['structures'] = []): Game {
  const scenario = createIslandAssault();
  scenario.structures.push(...structures);
  return new Game(scenario, { enableAI: false });
}

function validSite(game: Game, defId: string): { x: number; z: number } {
  for (let z = 20; z <= 44; z++) {
    for (let x = 8; x <= 34; x++) {
      if (game.placementStatus(0, defId, x, z).ok) return { x, z };
    }
  }
  throw new Error(`no valid site for ${defId}`);
}

describe('structure progression', () => {
  it('opens surveillance through the barracks and the advanced branches through the factory', () => {
    expect(buildingRequirements('powerPlant')).toEqual([]);
    expect(buildingRequirements('refinery')).toEqual([]);
    expect(buildingRequirements('barracks')).toEqual([]);
    expect(buildingRequirements('factory')).toEqual([]);
    expect(buildingRequirements('mgNest')).toEqual([]);
    expect(buildingRequirements('atTurret')).toEqual([]);

    expect(buildingRequirements('radar')).toEqual(['barracks']);

    expect(buildingRequirements('airfield')).toEqual(['factory']);
    expect(buildingRequirements('shipyard')).toEqual(['factory']);
    expect(buildingRequirements('samBattery')).toEqual(['factory']);
    expect(buildingRequirements('coastalBattery')).toEqual(['factory']);
  });

  it('keeps every prerequisite buildable and acyclic', () => {
    const buildableFamilies = new Set(BUILDABLE_BY_PLAYER.map((def) => buildingFamily(def.id)));
    for (const def of BUILDABLE_BY_PLAYER) {
      for (const requirement of buildingRequirements(def.id)) {
        expect(
          buildableFamilies.has(requirement),
          `${def.id} requires ${requirement}, which no player can build`,
        ).toBe(true);
      }
    }
    const walk = (id: string, path: string[]): void => {
      for (const requirement of buildingRequirements(id)) {
        expect(path, `${[...path, requirement].join(' -> ')} is a cycle`).not.toContain(requirement);
        walk(requirement, [...path, requirement]);
      }
    };
    for (const def of BUILDABLE_BY_PLAYER) walk(def.id, [def.id]);
  });

  it('keeps a national structure variant on its baseline tier', () => {
    // The shared MG nest is tier one, so the Hungarian bunker is too. The
    // lookup stays family-based so a future gated slot carries its variant.
    expect(buildingRequirements('bunker')).toEqual(buildingRequirements('mgNest'));
  });
});

describe('placement enforcement', () => {
  it('leaves the land base open from the first Command Post', () => {
    const game = gameWith();
    expect(game.missingTech(0, 'factory')).toEqual([]);
    const site = validSite(game, 'factory');
    expect(game.placementStatus(0, 'factory', site.x, site.z).ok).toBe(true);
  });

  it('refuses the radar while the barracks is missing', () => {
    const game = gameWith();
    expect(game.missingTech(0, 'radar')).toEqual([
      { family: 'barracks', defId: 'barracks', name: 'Field Barracks' },
    ]);
    const status = game.placementStatus(0, 'radar', 24, 29);
    expect(status.code).toBe('tech');
    expect(status.reason).toBe('Requires Field Barracks.');
  });

  it('accepts the radar once the barracks is operational and closes again when it is lost', () => {
    const game = gameWith([{ defId: 'barracks', owner: 0, x: 21, z: 28 }]);
    expect(game.missingTech(0, 'radar')).toEqual([]);
    const site = validSite(game, 'radar');
    expect(game.placementStatus(0, 'radar', site.x, site.z).ok).toBe(true);

    const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    barracks.construction = true;
    barracks.buildProgress = 0.5;
    expect(game.missingTech(0, 'radar').map((m) => m.family)).toEqual(['barracks']);

    barracks.construction = false;
    barracks.hp = 0;
    expect(game.missingTech(0, 'radar').map((m) => m.family)).toEqual(['barracks']);
  });

  it('still asks for the factory before advanced facilities', () => {
    const game = gameWith([{ defId: 'barracks', owner: 0, x: 21, z: 28 }]);
    for (const defId of ['airfield', 'shipyard', 'samBattery', 'coastalBattery']) {
      expect(game.missingTech(0, defId).map((m) => m.family)).toEqual(['factory']);
    }
  });

  it('rejects the command without charging the player', () => {
    const game = gameWith();
    const before = game.player(0)!.mats;
    game.enqueueCommand({ type: 'placeBuilding', team: 0, defId: 'radar', tileX: 24, tileZ: 29 });
    game.tick();
    expect(game.entitiesOf(0, 'building').some((e) => e.defId === 'radar')).toBe(false);
    // The HQ trickle still pays; the structure price does not.
    expect(game.player(0)!.mats).toBeGreaterThanOrEqual(before);
    expect(game.player(0)!.mats).toBeLessThan(before + BUILDINGS.radar.cost.mats);
    expect(
      game.state.events.some(
        (e) => e.type === 'orderFailed' && e.text === 'Requires Field Barracks.',
      ),
    ).toBe(true);
  });
});
