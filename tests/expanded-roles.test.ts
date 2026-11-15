import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { completeResearch } from './helpers';
import type { Scenario } from '../src/sim/scenario';

function arena(playerNation = 'lithuania'): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'expanded-roles-test';
  scenario.settings.seed = 404;
  scenario.settings.fog = true;
  scenario.players[0].factionId = playerNation;
  scenario.players[0].startX = 6;
  scenario.players[0].startZ = 6;
  scenario.players[1].factionId = 'russia';
  scenario.players[1].startX = size - 7;
  scenario.players[1].startZ = size - 7;
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'commandPost', owner: 1, x: size - 7, z: size - 7 },
  );
  return scenario;
}

function gameWith(scenario: Scenario): Game {
  const game = new Game(scenario, { enableAI: false });
  completeResearch(game, 0);
  return game;
}

describe('shared roster expansion', () => {
  it('gives both alliances a shared MANPADS team without taking the Kestrel away from Lithuania', () => {
    const defender = gameWith(arena('lithuania'));
    expect(defender.availableUnits(0)).toContain('manpadsTeam');
    expect(defender.availableUnits(0)).toContain('kestrelTeam');

    const eastern = gameWith(arena('russia'));
    expect(eastern.unitIdFor(0, 'manpadsTeam')).toBe('manpadsTeamEC');
    expect(eastern.availableUnits(0)).toContain('manpadsTeamEC');
    expect(eastern.unitIdFor(0, 'ewVehicle')).toBe('ewVehicleEC');
    expect(eastern.unitIdFor(0, 'loiteringMunition')).toBe('loiteringMunitionEC');
    expect(UNITS.manpadsTeamEC.cost.mats).toBeLessThan(UNITS.manpadsTeam.cost.mats);
    expect(UNITS.manpadsTeam.weapons).toEqual(['lightManpads']);
  });

  it('jams hostile vision inside the EW envelope and restores it when the emitter dies', () => {
    const scenario = arena();
    scenario.units.push(
      { defId: 'recon', owner: 0, x: 10, z: 10 },
      { defId: 'ewVehicle', owner: 1, x: 14, z: 10 },
      { defId: 'medic', owner: 1, x: 20, z: 10 },
    );
    const game = gameWith(scenario);
    const target = game.state.entities.find((e) => e.defId === 'medic' && e.owner === 1)!;
    const jammer = game.state.entities.find((e) => e.defId === 'ewVehicle' && e.owner === 1)!;

    game.advance(20);
    // Ten tiles is inside the scout's clear-day optics but outside them
    // once the adjacent jammer cuts its vision to 60%.
    expect(game.isVisibleTo(0, target.id)).toBe(false);

    jammer.hp = 0;
    game.advance(20);
    expect(game.isVisibleTo(0, target.id)).toBe(true);
  });

  it('expends a loitering munition after one shot and cannot recover it', () => {
    const scenario = arena();
    scenario.structures.push({ defId: 'airfield', owner: 0, x: 10, z: 10 });
    scenario.units.push(
      { defId: 'loiteringMunition', owner: 0, x: 12, z: 12 },
      { defId: 'tank', owner: 1, x: 18, z: 12 },
    );
    const game = gameWith(scenario);
    const drone = game.state.entities.find(
      (e) => e.defId === 'loiteringMunition' && e.owner === 0,
    )!;
    const target = game.state.entities.find((e) => e.defId === 'tank' && e.owner === 1)!;
    expect(drone.ammo).toBe(1);

    game.enqueueCommand({ type: 'attack', team: 0, ids: [drone.id], targetId: target.id });
    game.advance(20 * 40);

    expect(game.getEntity(drone.id)?.hp ?? 0).toBe(0);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(game.state.events.some((e) => e.type === 'unitLost' && /expended/i.test(e.text))).toBe(
      true,
    );
  });
});
