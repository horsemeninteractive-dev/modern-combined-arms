import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { unitFamily } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { SMOKE_RADIUS_TILES, UNIT_ABILITIES } from '../src/data/abilities';
import type { TechDef } from '../src/data/research';
import { AIController, initialAIState, researchOptionScore, aiProfile, type ResearchSignals } from '../src/sim/ai';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot, createTeamState } from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { abilityActions } from '../src/ui/abilityView';
import { ParticleSystem } from '../src/render/particles';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

const ABILITY = 'reconSmokescreen';

interface ArenaOptions {
  /** Explicit scenario-granted technologies for player 0. */
  technologies?: string[];
  units?: Array<{ defId: string; owner: number; x: number; z: number }>;
  structures?: Array<{ defId: string; owner: number; x: number; z: number }>;
  fog?: boolean;
  ai?: boolean;
}

/**
 * A 48x48 arena with both command posts far apart. Nothing is scripted beyond
 * what a test names, so a measurement is the feature's own behaviour.
 */
function arena(options: ArenaOptions = {}): Scenario {
  const scenario = createEmptyScenario(48, 48);
  scenario.meta.id = 'smoke-test';
  scenario.settings.seed = 77;
  scenario.settings.fog = options.fog ?? true;
  scenario.settings.startingMats = 3000;
  scenario.settings.startingReq = 400;
  scenario.players[0].factionId = 'lithuania';
  scenario.players[0].startX = 20;
  scenario.players[0].startZ = 20;
  scenario.players[1].factionId = 'russia';
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 44;
  scenario.players[1].isAI = options.ai ?? false;
  if (options.technologies) scenario.players[0].technologies = [...options.technologies];
  // Scenario structure and unit coordinates are tile indices; the simulation
  // stores world units, so a test that cares about distance converts.
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 16, z: 16 },
    { defId: 'commandPost', owner: 1, x: 42, z: 42 },
  );
  for (const s of options.structures ?? []) scenario.structures.push({ ...s });
  for (const u of options.units ?? []) scenario.units.push({ ...u });
  return scenario;
}

function build(options: ArenaOptions = {}): Game {
  return new Game(arena(options), { enableAI: false });
}

function reconOf(game: Game, owner = 0): Entity {
  const recon = game.entitiesOf(owner, 'unit').find((e) => unitFamily(e.defId) === 'recon');
  if (!recon) throw new Error('arena has no recon unit');
  return recon;
}

function use(game: Game, unit: Entity, team = 0): void {
  game.enqueueCommand({ type: 'useAbility', team, unitId: unit.id, abilityId: ABILITY });
}

describe('recon smokescreen availability', () => {
  it('is hidden until the technology completes, then offered to every recon hull', () => {
    const game = build({
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'rifle', owner: 0, x: 22, z: 20 },
      ],
    });
    const recon = reconOf(game);
    const rifle = game.entitiesOf(0, 'unit').find((e) => e.defId === 'rifle')!;
    expect(abilityActions(game, 0, recon.id)).toEqual([]);
    expect(game.abilityStatus(0, recon.id, ABILITY).reason).toMatch(/has not been researched/);

    game.player(0)!.research.completed.push('manoeuvre1');
    const actions = abilityActions(game, 0, recon.id);
    expect(actions.map((action) => action.upgradeId)).toEqual([ABILITY]);
    expect(actions[0].ready).toBe(true);
    expect(actions[0].label).toBe('READY');
    // A rifle section has no panel entry at all.
    expect(abilityActions(game, 0, rifle.id)).toEqual([]);
  });

  it('resolves a national recon replacement through its canonical slot', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'pathfinder', owner: 0, x: 20, z: 20 }],
    });
    expect(game.unitIdFor(0, 'recon')).toBe('pathfinder');
    const pathfinder = reconOf(game);
    expect(game.abilityStatus(0, pathfinder.id, ABILITY).ok).toBe(true);
  });

  it('gives a newly produced recon the ability without touching the player record', () => {
    const game = build({
      structures: [{ defId: 'factory', owner: 0, x: 20, z: 28 }],
      units: [{ defId: 'engineer', owner: 0, x: 20, z: 24 }],
    });
    game.player(0)!.research.completed.push('manoeuvre1');
    const factory = game.entitiesOf(0, 'building').find((b) => b.defId === 'factory')!;
    const before = new Set(game.state.entities.map((e) => e.id));
    game.enqueueCommand({
      type: 'produce',
      team: 0,
      buildingId: factory.id,
      defId: game.unitIdFor(0, 'recon')!,
    });
    game.advance(TICK_RATE * 45);
    const produced = game.entitiesOf(0, 'unit').find((e) => !before.has(e.id));
    expect(produced).toBeDefined();
    expect(game.abilityStatus(0, produced!.id, ABILITY).ok).toBe(true);
    // The ability is availability, not a fitting: nothing was applied to the hull.
    expect(game.appliedUpgrades(produced!.id)).toEqual([]);
  });

  it('never gives the ability to the opposing seat', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'recon', owner: 1, x: 150, z: 150 },
      ],
    });
    const enemyRecon = reconOf(game, 1);
    expect(abilityActions(game, 1, enemyRecon.id)).toEqual([]);
    expect(game.abilityStatus(1, enemyRecon.id, ABILITY).ok).toBe(false);
  });

  it('accepts an explicit scenario grant through the same resolver', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    expect(game.completedTechnologies(0)).toContain('manoeuvre1');
    expect(game.abilityStatus(0, reconOf(game).id, ABILITY).ok).toBe(true);
  });
});

describe('recon smokescreen activation', () => {
  it('lays an authoritative cloud at the hull and starts its own reload', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    const bank = game.player(0)!.mats;
    use(game, recon);
    game.tick();

    expect(game.state.smoke).toHaveLength(1);
    const cloud = game.state.smoke[0];
    expect(cloud.owner).toBe(0);
    expect(cloud.team).toBe(0);
    expect(cloud.x).toBeCloseTo(recon.x);
    expect(cloud.z).toBeCloseTo(recon.z);
    expect(cloud.radius).toBe(SMOKE_RADIUS_TILES * TILE_SIZE);
    expect(cloud.expiresTick - cloud.startTick).toBe(8 * TICK_RATE);
    // The tick that processed the order has already aged the reload by one step.
    expect(game.cooldownRemaining(recon.id, ABILITY)).toBeGreaterThan(44.9);
    expect(game.cooldownRemaining(recon.id, ABILITY)).toBeLessThanOrEqual(45);

    const ack = game.state.events.find((event) => event.code === 'abilityUsed');
    expect(ack?.type).toBe('orderAck');
    expect(ack?.entityId).toBe(recon.id);
    // The ability itself costs nothing; the reload is the limiter. The bank only
    // moved because the headquarters trickles a little material each second.
    expect(game.player(0)!.mats - bank).toBeLessThan(0.1);
  });

  it('rejects every illegal activation without spending a cooldown', () => {
    const game = build({
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'rifle', owner: 0, x: 22, z: 20 },
        { defId: 'recon', owner: 1, x: 150, z: 150 },
      ],
    });
    const recon = reconOf(game);
    const rifle = game.entitiesOf(0, 'unit').find((e) => e.defId === 'rifle')!;
    const enemyRecon = reconOf(game, 1);

    use(game, recon);
    use(game, rifle);
    use(game, enemyRecon);
    use(game, recon, 1);
    game.tick();

    expect(game.state.smoke).toEqual([]);
    expect(game.cooldownRemaining(recon.id, ABILITY)).toBe(0);
    const failure = game.state.events.find((event) => event.type === 'orderFailed');
    expect(failure?.text).toMatch(/has not been researched|cannot be fitted|A living unit/);
  });

  it('refuses a dead hull', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    recon.hp = 0;
    expect(game.abilityStatus(0, recon.id, ABILITY)).toMatchObject({
      ok: false,
      reason: 'A living unit is required.',
    });
  });

  it('reloads each hull independently and blocks a second shot while reloading', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'recon', owner: 0, x: 24, z: 20 },
      ],
    });
    const [first, second] = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'recon');
    use(game, first);
    game.tick();
    expect(game.state.smoke).toHaveLength(1);
    expect(game.abilityStatus(0, first.id, ABILITY).ok).toBe(false);
    expect(game.abilityStatus(0, second.id, ABILITY).ok).toBe(true);

    use(game, first);
    game.tick();
    expect(game.state.smoke).toHaveLength(1);
    expect(abilityActions(game, 0, first.id)[0]).toMatchObject({ ready: false });
    expect(abilityActions(game, 0, first.id)[0].detail).toMatch(/Reloading — 4[45]s/);

    use(game, second);
    game.tick();
    expect(game.state.smoke).toHaveLength(2);
    expect(game.cooldownRemaining(second.id, ABILITY)).toBeGreaterThan(44.9);

    // The reload is simulation time: it clears on its own.
    game.advance(TICK_RATE * 46);
    expect(game.cooldownRemaining(first.id, ABILITY)).toBe(0);
  });
});

describe('smoke on the battlefield', () => {
  it('hides its occupants from an outside observer and clears on expiry', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      // Six tiles east of the recon: inside a Command Post's ten-tile vision.
      structures: [{ defId: 'commandPost', owner: 1, x: 26, z: 20 }],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    const observer = game.entitiesOf(1, 'building').filter((b) => b.defId === 'commandPost')[1];
    game.advance(TICK_RATE);
    expect(game.isVisibleTo(1, recon.id)).toBe(true);

    use(game, recon);
    game.tick();
    game.advance(TICK_RATE);
    expect(game.isVisibleTo(1, recon.id)).toBe(false);
    // The cloud is not a wall: the same crew sees out of it.
    expect(game.isVisibleTo(0, observer.id)).toBe(true);

    game.advance(8 * TICK_RATE);
    expect(game.state.smoke).toEqual([]);
    expect(game.isVisibleTo(1, recon.id)).toBe(true);
  });

  it('does not blind a radar, which is not a visual sensor', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [
        { defId: 'radarStation', owner: 1, x: 30, z: 20 },
        { defId: 'commandPost', owner: 1, x: 34, z: 32 },
      ],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    expect(BUILDINGS.radarStation.scanRadius).toBeGreaterThan(0);
    const recon = reconOf(game);
    use(game, recon);
    game.tick();
    game.advance(TICK_RATE);
    // 22-tile station radius covers the cloud, and radar plots through smoke.
    expect(game.isVisibleTo(1, recon.id)).toBe(true);
  });

  it('stops a direct-fire crew from shooting into a cloud it is not standing in', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        // Six tiles out: beyond the five-tile cloud, inside the tank's range.
        { defId: 'tank', owner: 1, x: 26, z: 20 },
      ],
    });
    const recon = reconOf(game);
    const tank = game.entitiesOf(1, 'unit').find((e) => e.defId === 'tank')!;
    use(game, recon);
    game.tick();
    expect(game.smokeScreens(tank.x, tank.z, recon.x, recon.z)).toBe(true);
    // A crew inside the same cloud is not screened from what it can see.
    expect(game.smokeScreens(recon.x, recon.z, recon.x, recon.z)).toBe(false);

    game.enqueueCommand({ type: 'attack', team: 1, ids: [tank.id], targetId: recon.id });
    const before = recon.hp;
    for (let i = 0; i < 15; i++) game.tick();
    const fired = game.state.events.filter(
      (event) => event.type === 'shot' && event.entityId === tank.id,
    );
    expect(fired).toHaveLength(0);
    expect(recon.hp).toBe(before);
  });

  it('keeps overlapping clouds deterministic and drops them cleanly', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'recon', owner: 0, x: 24, z: 20 },
      ],
    });
    const [first, second] = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'recon');
    use(game, first);
    game.tick();
    use(game, second);
    game.tick();
    expect(game.state.smoke).toHaveLength(2);
    const centre = (first.x + second.x) / 2;
    expect(game.smokeCoversPoint(centre, first.z)).toBe(true);
    // Overlap does not change the rule: the far side is screened either way.
    expect(game.smokeScreens(centre + 120, first.z, centre, first.z)).toBe(true);

    const hash = game.stateHash();
    const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(loaded.stateHash()).toBe(hash);

    game.advance(9 * TICK_RATE);
    expect(game.state.smoke).toEqual([]);
    expect(game.smokeCoversPoint(centre, first.z)).toBe(false);
  });

  it('does not block movement', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'rifle', owner: 0, x: 18, z: 20 },
      ],
    });
    const recon = reconOf(game);
    const blockedBefore = Uint8Array.from(game.blocked);
    use(game, recon);
    game.tick();
    // Nothing was stamped into the navigation grid: a cloud is not a wall.
    expect(Uint8Array.from(game.blocked)).toEqual(blockedBefore);

    const rifle = game.entitiesOf(0, 'unit').find((e) => e.defId === 'rifle')!;
    const destination = (24 + 0.5) * TILE_SIZE;
    game.enqueueCommand({ type: 'move', team: 0, ids: [rifle.id], x: destination, z: rifle.z });
    const start = Math.abs(destination - rifle.x);
    game.advance(TICK_RATE);
    // It walked through the cloud towards the far side.
    expect(rifle.x).toBeGreaterThan((18 + 0.5) * TILE_SIZE);
    expect(Math.abs(destination - rifle.x)).toBeLessThan(start);
  });
});

describe('smoke persistence and authority', () => {
  it('restores an active cloud and its reload from a save', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    use(game, recon);
    game.tick();
    game.advance(TICK_RATE * 3);
    const remaining = game.cooldownRemaining(recon.id, ABILITY);
    const save = JSON.parse(JSON.stringify(game.toSave()));

    const loaded = Game.fromSave(save, { enableAI: false });
    expect(loaded.state.smoke).toHaveLength(1);
    expect(loaded.state.smoke[0].expiresTick).toBe(game.state.smoke[0].expiresTick);
    expect(loaded.cooldownRemaining(recon.id, ABILITY)).toBeCloseTo(remaining, 3);
    expect(loaded.stateHash()).toBe(game.stateHash());

    // The load survives to expiry rather than resurrecting the cloud.
    loaded.advance(9 * TICK_RATE);
    expect(loaded.state.smoke).toEqual([]);
  });

  it('loads a save written before smoke existed', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    use(game, recon);
    game.tick();
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.state.smoke;
    delete save.state.nextSmokeId;
    for (const entity of save.state.entities) delete entity.cooldowns;

    const loaded = Game.fromSave(save, { enableAI: false });
    expect(loaded.state.smoke).toEqual([]);
    expect(loaded.cooldownRemaining(recon.id, ABILITY)).toBe(0);
    expect(loaded.abilityStatus(0, recon.id, ABILITY).ok).toBe(true);
  });

  it('validates the command through the gate and rejects illegal seats', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'recon', owner: 1, x: 150, z: 150 },
      ],
    });
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
    const own = reconOf(game);
    const enemy = reconOf(game, 1);
    const envelope = (command: unknown) => ({ v: 1, command });

    const foreign = gate.submit(0, envelope({ type: 'useAbility', unitId: enemy.id, abilityId: ABILITY }), 1000);
    expect(foreign).toMatchObject({ ok: false, code: 'not-your-entity' });
    const denied = gate.submit(1, envelope({ type: 'useAbility', unitId: own.id, abilityId: ABILITY }), 1200);
    expect(denied).toMatchObject({ ok: false, code: 'not-your-entity' });
    const locked = gate.submit(0, envelope({ type: 'useAbility', unitId: own.id, abilityId: ABILITY }), 1400);
    // Seat 0 has the research, so the gate accepts and queues it.
    expect(locked.ok).toBe(true);
    const unseated = gate.submit(1, envelope({ type: 'useAbility', unitId: enemy.id, abilityId: ABILITY }), 1600);
    expect(unseated).toMatchObject({ ok: false, code: 'upgrade-unavailable' });
  });

  it('replicates the cloud and the reload, never the opponent’s reload', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [
        { defId: 'recon', owner: 0, x: 20, z: 20 },
        { defId: 'recon', owner: 1, x: 150, z: 150 },
      ],
    });
    const recon = reconOf(game);
    const enemy = reconOf(game, 1);
    use(game, recon);
    game.tick();
    const snapshot = createTeamSnapshot(game, 0);
    expect(snapshot.smoke).toHaveLength(1);

    const own = createTeamState(game, 0, 0);
    expect(own.entities.find((e) => e.id === recon.id)!.cooldowns).toMatchObject({
      [ABILITY]: expect.any(Number),
    });
    // The opponent is visible in this fog-free arena but its reload is not sent.
    const enemyState = createTeamState(game, 1, 0);
    expect(enemyState.entities.find((e) => e.id === recon.id)?.cooldowns).toBeUndefined();
    expect(enemyState.entities.find((e) => e.id === enemy.id)).toBeDefined();

    const assembler = new SnapshotAssembler({ roomId: 'room-smoke', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: snapshot.tick,
        team: 0,
        roomId: 'room-smoke',
        checkpoint: false,
        state: snapshot,
      }).ok,
    ).toBe(true);
    expect(assembler.state()!.smoke).toHaveLength(1);

    // Expiry travels as a whole-list replacement in the next delta.
    game.advance(9 * TICK_RATE);
    const state = createTeamState(game, 0, game.state.eventSeq);
    const changes = buildDelta(createBaseline(snapshot), state, game.state.fog[0]);
    expect(changes.smoke).toEqual([]);
    expect(
      assembler.apply({
        type: 'delta',
        v: 2,
        epoch: 1,
        seq: 2,
        base: 1,
        tick: state.tick,
        team: 0,
        roomId: 'room-smoke',
        changes,
      }).ok,
    ).toBe(true);
    expect(assembler.state()!.smoke).toEqual([]);
  });

  it('gives a rejoining client the cloud that is still burning', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'recon', owner: 0, x: 20, z: 20 }],
    });
    const recon = reconOf(game);
    use(game, recon);
    game.tick();
    game.advance(TICK_RATE * 2);
    // A reconnect has no baseline at all: it is a fresh sync.
    const rejoined = createTeamSnapshot(game, 0);
    const assembler = new SnapshotAssembler({ roomId: 'room-smoke', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: rejoined.tick,
        team: 0,
        roomId: 'room-smoke',
        checkpoint: false,
        state: rejoined,
      }).ok,
    ).toBe(true);
    expect(assembler.state()!.smoke[0].expiresTick).toBe(game.state.smoke[0].expiresTick);
    expect(
      assembler.state()!.entities.find((entity) => entity.id === recon.id)?.cooldowns,
    ).toBeDefined();
  });
});

describe('AI use of the smokescreen', () => {
  const GRANT_ONLY: TechDef = {
    id: 'fixtureSmokeDoctrine',
    name: 'Fixture Smoke Doctrine',
    easternName: 'Fixture Smoke Doctrine',
    branch: 'manoeuvre',
    tier: 1,
    cost: { mats: 100, req: 10 },
    seconds: 20,
    requires: [],
    effects: [{ kind: 'grantUnitUpgrade', upgrade: ABILITY }],
    description: '',
    icon: 'recon',
  };
  function signals(overrides: Partial<ResearchSignals> = {}): ResearchSignals {
    return {
      seed: 101,
      tick: 0,
      timeLimitSec: null,
      completed: [],
      unitCounts: new Map(),
      buildingCounts: new Map(),
      rosterUnits: new Set(['recon', 'tank', 'rifle']),
      exclusiveTechs: new Set(),
      profile: aiProfile(101, 'veteran'),
      strategy: 'armour',
      mix: { armour: 0, infantry: 0 },
      enemyAir: 0,
      enemyNaval: 0,
      fortified: 0,
      hasWater: true,
      ...overrides,
    };
  }

  it('values an implemented ability only for an army that can fire it', () => {
    const option = researchOptionScore(GRANT_ONLY, signals({ unitCounts: new Map([['recon', 2]]), mix: { armour: 3, infantry: 1 } }));
    expect(option.score).toBeGreaterThan(0);
    expect(option.reason).toContain('Recon Smokescreen');

    // A nation that never fields a recon slot has no use for it.
    const noSlot = researchOptionScore(
      GRANT_ONLY,
      signals({ rosterUnits: new Set(['tank', 'rifle']), unitCounts: new Map([['recon', 2]]) }),
    );
    expect(noSlot.score).toBe(0);
    expect(noSlot.reason).toBe('no playable effect');
  });

  it('still refuses modules with no installation pathway', () => {
    const moduleTech: TechDef = {
      ...GRANT_ONLY,
      id: 'fixtureModuleDoctrine',
      effects: [{ kind: 'grantBuildingModule', module: 'advancedTurbine' }],
    };
    const option = researchOptionScore(moduleTech, signals({ unitCounts: new Map([['recon', 2]]) }));
    expect(option.score).toBe(0);
    expect(option.reason).toBe('no playable effect');
  });

  it('pops smoke from a damaged recon troop that is under pressure', () => {
    const scenario = arena({
      fog: false,
      ai: true,
      technologies: [],
      structures: [{ defId: 'factory', owner: 1, x: 40, z: 28 }],
      units: [
        { defId: 'recon', owner: 1, x: 40, z: 20 },
        { defId: 'rifle', owner: 0, x: 46, z: 20 },
      ],
    });
    scenario.players[1].technologies = ['manoeuvre1'];
    const game = new Game(scenario, { enableAI: false });
    const recon = reconOf(game, 1);
    recon.hp = recon.maxHp * 0.4;

    const ai = new AIController();
    const state = initialAIState(7, 'veteran');
    game.advance(20);
    ai.update(game, 1, state);
    expect(game.pending.some((command) => command.type === 'useAbility')).toBe(true);

    // The same commander without the research keeps its dischargers stowed.
    const locked = new Game(
      (() => {
        const s = arena({
          fog: false,
          ai: true,
          units: [
            { defId: 'recon', owner: 1, x: 40, z: 20 },
            { defId: 'rifle', owner: 0, x: 46, z: 20 },
          ],
        });
        return s;
      })(),
      { enableAI: false },
    );
    const lockedRecon = reconOf(locked, 1);
    lockedRecon.hp = lockedRecon.maxHp * 0.4;
    const lockedAi = new AIController();
    const lockedState = initialAIState(7, 'veteran');
    locked.advance(20);
    lockedAi.update(locked, 1, lockedState);
    expect(locked.pending.some((command) => command.type === 'useAbility')).toBe(false);
  });

  it('is deterministic about it', () => {
    const scenario = arena({
      fog: false,
      ai: true,
      structures: [{ defId: 'factory', owner: 1, x: 40, z: 28 }],
      units: [
        { defId: 'recon', owner: 1, x: 40, z: 20 },
        { defId: 'rifle', owner: 0, x: 46, z: 20 },
      ],
    });
    scenario.players[1].technologies = ['manoeuvre1'];
    const play = (): string[] => {
      const game = new Game(scenario, { enableAI: false });
      const recon = reconOf(game, 1);
      recon.hp = recon.maxHp * 0.4;
      const ai = new AIController();
      const state = initialAIState(7, 'veteran');
      game.advance(20);
      ai.update(game, 1, state);
      return game.pending.map((command) => command.type);
    };
    expect(play()).toEqual(play());
  });

  it('registers exactly one playable ability in the catalogue', () => {
    expect(Object.keys(UNIT_ABILITIES)).toEqual([ABILITY]);
    expect(UNIT_ABILITIES[ABILITY].radius).toBe(SMOKE_RADIUS_TILES);
  });
});

describe('smoke rendering', () => {
  it('emits a bounded, radius-scaled puff set that thins with density', () => {
    const particles = new ParticleSystem();
    particles.smokeScreen(10, 1, 10, 20, 1);
    expect(particles.particles.length).toBe(4);
    expect(particles.particles[0].size1).toBeCloseTo(21);
    expect(particles.particles[0].additive).toBe(false);

    particles.clear();
    particles.smokeScreen(10, 1, 10, 20, 0.2);
    expect(particles.particles.length).toBe(1);
    // A thinning cloud is fainter, not just sparser.
    expect(particles.particles[0].alpha).toBeLessThan(0.2);
  });
});
