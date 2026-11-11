/**
 * Phase 6C.1 — defensive structure engagements.
 *
 * The Phase 6C attempt at this produced one shot and no exchange, which was a
 * fixture failure rather than a game finding. This file builds the arena from
 * scratch on empty ground: one emplacement, one power plant, one raiding force
 * placed at a known distance, and an explicit attack order. Every shot is
 * attributed by the shooter's entity id, so building fire cannot be lost the way
 * it was in Phase 6B.2.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import { TERRAIN } from '../src/sim/terrain';
import type { Scenario, ScenarioTile } from '../src/sim/scenario';
import type { TerrainId } from '../src/sim/terrain';

interface DefenceFixture {
  structure: string;
  attackers: string[];
  gap?: number;
  seconds?: number;
  air?: boolean;
  secondStructure?: string;
}

interface DefenceResult {
  shots: Record<string, number>;
  firstShotSecond: number | null;
  damageToAttackers: number;
  attackersLost: number;
  attackerHpStart: number;
  structureHpStart: number;
  structureHpEnd: number;
  buildId: number;
}

/** Empty ground: no terrain surprises, no pre-placed units, no AI. */
function landArena(options: DefenceFixture): { game: Game; result: DefenceResult } {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.fog = false;
  scenario.units = [];
  // Both headquarters must stand, or the empty arena resolves as an immediate
  // victory on tick one and nothing ever fires twice.
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'commandPost', owner: 1, x: 56, z: 56 },
    { defId: options.structure, owner: 0, x: 28, z: 30 },
    { defId: 'powerPlant', owner: 0, x: 22, z: 34 },
  ];
  if (options.secondStructure) {
    scenario.structures.push({ defId: options.secondStructure, owner: 0, x: 34, z: 30 });
  }
  if (options.air) {
    scenario.structures.push(
      { defId: 'airfield', owner: 1, x: 50, z: 40 },
      { defId: 'heliport', owner: 1, x: 50, z: 30 },
    );
  }
  const gap = options.gap ?? 7;
  options.attackers.forEach((defId, index) => {
    scenario.units.push({
      defId,
      owner: 1,
      x: 28 + gap,
      z: 30 + (index - (options.attackers.length - 1) / 2) * 0.9,
    });
  });
  return run(scenario, options);
}

function run(
  scenario: Scenario,
  options: DefenceFixture & { site?: { x: number; z: number } },
): { game: Game; result: DefenceResult } {
  const game = new Game(scenario, { enableAI: false });
  if (game.state.victory !== 'playing') {
    throw new Error(`fixture resolved immediately: ${game.state.victory}`);
  }
  game.refreshVision(false);
  const build = game
    .entitiesOf(0, 'building')
    .find((e) => e.defId === options.structure)!;
  if (!build) throw new Error(`fixture did not create ${options.structure}`);
  const attackers = game.entitiesOf(1, 'unit');
  if (attackers.length === 0) throw new Error('fixture did not create attackers');
  // Aircraft do not take an attack order against a structure: it does not
  // launch them. A move order toward the emplacement does, which is what puts
  // them inside the battery's envelope.
  const aircraft = attackers.filter((e) => e.aircraft);
  const ground = attackers.filter((e) => !e.aircraft);
  if (aircraft.length > 0) {
    game.enqueueCommand({
      type: 'move',
      team: 1,
      ids: aircraft.map((e) => e.id),
      x: build.x - 9 * 4,
      z: build.z,
    });
  }
  if (ground.length > 0) {
    game.enqueueCommand({
      type: 'attack',
      team: 1,
      ids: ground.map((e) => e.id),
      targetId: build.id,
    });
  }

  const shots: Record<string, number> = {};
  let firstShotSecond: number | null = null;
  const hpStart = new Map(attackers.map((e) => [e.id, e.hp]));
  const attackerHpStart = attackers.reduce((n, e) => n + e.maxHp, 0);
  const structureHpStart = build.hp;
  const seconds = options.seconds ?? 45;
  let lastSeq = 0;
  for (let i = 0; i < seconds * 20; i++) {
    game.advance(1);
    for (const event of game.state.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (event.type !== 'shot') continue;
      if (event.entityId !== build.id) continue;
      const weaponId = (event as { weaponId?: string }).weaponId ?? 'unknown';
      shots[weaponId] = (shots[weaponId] ?? 0) + 1;
      if (firstShotSecond === null) firstShotSecond = Math.round((i / 20) * 100) / 100;
    }
  }
  let damageToAttackers = 0;
  let attackersLost = 0;
  for (const attacker of attackers) {
    const now = game.getEntity(attacker.id);
    const start = hpStart.get(attacker.id) ?? 0;
    if (!now || now.hp <= 0) {
      damageToAttackers += start;
      attackersLost++;
    } else {
      damageToAttackers += Math.max(0, start - now.hp);
    }
  }
  const live = game.getEntity(build.id);
  return {
    game,
    result: {
      shots,
      firstShotSecond,
      damageToAttackers: Math.round(damageToAttackers),
      attackersLost,
      attackerHpStart: Math.round(attackerHpStart),
      structureHpStart: Math.round(structureHpStart),
      structureHpEnd: Math.round(Math.max(0, live?.hp ?? 0)),
      buildId: build.id,
    },
  };
}

function shotsFired(result: DefenceResult): number {
  return Object.values(result.shots).reduce((a, b) => a + b, 0);
}

describe('MG nest', () => {
  it('shreds rifle infantry inside its reach', () => {
    const { result } = landArena({ structure: 'mgNest', attackers: ['rifle', 'rifle', 'rifle'] });
    console.log('[def]', JSON.stringify({ kind: 'mg-vs-rifles', ...result, shotsFired: shotsFired(result) }));
    expect(shotsFired(result)).toBeGreaterThan(2);
    expect(result.attackersLost).toBeGreaterThanOrEqual(1);
    expect(result.damageToAttackers).toBeGreaterThan(0);
  });

  it('is nearly useless against armour', () => {
    const rifles = landArena({ structure: 'mgNest', attackers: ['rifle', 'rifle', 'rifle'] });
    const tank = landArena({ structure: 'mgNest', attackers: ['tank'] });
    const rifleKill = (rifles.result.damageToAttackers / 3) / 100;
    const tankKill = tank.result.damageToAttackers / 100;
    console.log('[def]', JSON.stringify({
      kind: 'mg-vs-armour',
      rifles: rifles.result.damageToAttackers,
      tank: tank.result.damageToAttackers,
      rifleKill,
      tankKill,
      shotsAtTank: shotsFired(tank.result),
    }));
    // It may still shoot a tank; what matters is that it barely scratches it.
    expect(tank.result.damageToAttackers).toBeLessThan(rifles.result.damageToAttackers);
  });
});

describe('AT gun', () => {
  it('kills armour at reach and is poor against dispersed infantry', () => {
    const tank = landArena({ structure: 'atTurret', attackers: ['tank'], gap: 9 });
    const infantry = landArena({ structure: 'atTurret', attackers: ['rifle', 'rifle'], gap: 9 });
    console.log('[def]', JSON.stringify({
      kind: 'at-gun',
      tank: tank.result,
      infantry: infantry.result,
      tankShots: shotsFired(tank.result),
      infantryShots: shotsFired(infantry.result),
    }));
    expect(shotsFired(tank.result)).toBeGreaterThan(1);
    expect(tank.result.attackersLost).toBeGreaterThanOrEqual(1);
    expect(infantry.result.damageToAttackers).toBeLessThan(tank.result.damageToAttackers);
  });

  it('fires on a light vehicle but not for long', () => {
    const apc = landArena({ structure: 'atTurret', attackers: ['apc'], gap: 9 });
    console.log('[def]', JSON.stringify({ kind: 'at-vs-light', ...apc.result, shots: shotsFired(apc.result) }));
    expect(shotsFired(apc.result)).toBeGreaterThan(0);
  });
});

describe('SAM', () => {
  it('engages helicopters and fixed-wing aircraft', () => {
    const helo = landArena({
      structure: 'samBattery',
      attackers: ['attackHelo', 'attackHelo'],
      gap: 10,
      air: true,
      seconds: 60,
    });
    const jet = landArena({
      structure: 'samBattery',
      attackers: ['fighter'],
      gap: 10,
      air: true,
      seconds: 60,
    });
    console.log('[def]', JSON.stringify({
      kind: 'sam-air',
      helo: { ...helo.result, shotsFired: shotsFired(helo.result) },
      jet: { ...jet.result, shotsFired: shotsFired(jet.result) },
    }));
    expect(shotsFired(helo.result)).toBeGreaterThan(0);
    expect(helo.result.attackersLost).toBeGreaterThanOrEqual(1);
    expect(shotsFired(jet.result)).toBeGreaterThan(0);
  });

  it('refuses a ground target entirely', () => {
    const tank = landArena({ structure: 'samBattery', attackers: ['tank'], gap: 8, seconds: 30 });
    console.log('[def]', JSON.stringify({ kind: 'sam-vs-ground', ...tank.result }));
    expect(shotsFired(tank.result)).toBe(0);
  });
});

/** A land tile beside water, with a water tile in firing reach of it. */
function coast(sceanrio: Scenario): { land: { x: number; z: number }; sea: { x: number; z: number } } {
  const scenario = sceanrio;
  const width = scenario.width;
  const water = (x: number, z: number): boolean => {
    const tile = scenario.tiles[z * width + x] as ScenarioTile | undefined;
    if (!tile) return false;
    return TERRAIN[tile.t as TerrainId]?.water === true;
  };
  for (let z = 6; z < scenario.height - 6; z++) {
    for (let x = 6; x < width - 6; x++) {
      if (water(x, z)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!water(x + dx, z + dz)) continue;
        // A sea tile a few tiles out, so the boat is inside the battery's reach
        // without being on top of it.
        for (let d = 3; d <= 12; d++) {
          const sx = x + dx * d;
          const sz = z + dz * d;
          if (sx < 1 || sz < 1 || sx >= width - 1 || sz >= scenario.height - 1) break;
          if (water(sx, sz)) return { land: { x, z }, sea: { x: sx, z: sz } };
        }
      }
    }
  }
  throw new Error('island map has no coast');
}

describe('coastal battery', () => {
  it('engages a surface hull from the shore', () => {
    const scenario = createIslandAssault();
    const spot = coast(scenario);
    scenario.units = [];
    scenario.structures = [
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 56, z: 56 },
      { defId: 'coastalBattery', owner: 0, x: spot.land.x, z: spot.land.z },
      { defId: 'powerPlant', owner: 0, x: spot.land.x - 2, z: spot.land.z + 2 },
    ];
    scenario.settings.fog = false;
    scenario.units.push({ defId: 'missileBoat', owner: 1, x: spot.sea.x, z: spot.sea.z });
    const { result } = run(scenario, {
      structure: 'coastalBattery',
      attackers: ['missileBoat'],
      seconds: 60,
      site: spot.land,
    });
    console.log('[def]', JSON.stringify({ kind: 'coastal-vs-boat', spot, ...result, shots: shotsFired(result) }));
    expect(shotsFired(result)).toBeGreaterThan(0);
    expect(result.damageToAttackers).toBeGreaterThan(0);
  });

  it('refuses a ground target', () => {
    const scenario = createIslandAssault();
    const spot = coast(scenario);
    scenario.units = [];
    scenario.structures = [
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 56, z: 56 },
      { defId: 'coastalBattery', owner: 0, x: spot.land.x, z: spot.land.z },
      { defId: 'powerPlant', owner: 0, x: spot.land.x - 2, z: spot.land.z + 2 },
    ];
    scenario.settings.fog = false;
    scenario.units.push({ defId: 'tank', owner: 1, x: spot.land.x + 3, z: spot.land.z });
    const { result } = run(scenario, {
      structure: 'coastalBattery',
      attackers: ['tank'],
      seconds: 30,
      site: spot.land,
    });
    console.log('[def]', JSON.stringify({ kind: 'coastal-vs-ground', ...result }));
    expect(shotsFired(result)).toBe(0);
  });
});
