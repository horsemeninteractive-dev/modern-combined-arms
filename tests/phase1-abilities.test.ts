import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { Terrain } from '../src/sim/terrain';
import { TICK_RATE, TILE_SIZE, VISION_INTERVAL } from '../src/sim/constants';
import { UNIT_ABILITIES, SMOKE_RADIUS_TILES, abilityForUpgrade } from '../src/data/abilities';
import { BUILDING_MODULES, RESEARCH, installedModuleEffects, techDef, unitUpgradeDef } from '../src/data/research';
import { unitFamily } from '../src/data/units';
import { AIController, initialAIState } from '../src/sim/ai';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot, createTeamState } from '../src/multiplayer/projection';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { abilityActions } from '../src/ui/abilityView';
import { moduleActions } from '../src/ui/moduleView';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

interface ArenaOptions {
  technologies?: string[];
  enemyTechnologies?: string[];
  units?: Array<{ defId: string; owner: number; x: number; z: number }>;
  structures?: Array<{ defId: string; owner: number; x: number; z: number }>;
  fog?: boolean;
  ai?: boolean;
  nation?: string;
  mats?: number;
  req?: number;
  water?: { x: number; z: number; w: number; h: number };
}

function arena(options: ArenaOptions = {}): Scenario {
  const scenario = createEmptyScenario(48, 48);
  scenario.meta.id = 'phase1-abilities';
  scenario.settings.seed = 91;
  scenario.settings.fog = options.fog ?? false;
  scenario.settings.startingMats = options.mats ?? 3000;
  scenario.settings.startingReq = options.req ?? 400;
  scenario.players[0].factionId = options.nation ?? 'lithuania';
  scenario.players[0].startX = 20;
  scenario.players[0].startZ = 20;
  scenario.players[1].factionId = 'russia';
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 44;
  scenario.players[1].isAI = options.ai ?? false;
  if (options.technologies) scenario.players[0].technologies = [...options.technologies];
  if (options.enemyTechnologies) scenario.players[1].technologies = [...options.enemyTechnologies];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 16, z: 16 },
    { defId: 'commandPost', owner: 1, x: 42, z: 42 },
  );
  for (const s of options.structures ?? []) scenario.structures.push({ ...s });
  for (const u of options.units ?? []) scenario.units.push({ ...u });
  if (options.water) {
    const { x, z, w, h } = options.water;
    for (let tz = z; tz < z + h; tz++) {
      for (let tx = x; tx < x + w; tx++) {
        const tile = scenario.tiles[tz * scenario.width + tx];
        // Kept as a scenario tile so the Game builds the map through the normal
        // authoring path rather than a test-only terrain shortcut.
        tile.t = Terrain.DeepWater;
        tile.e = 0;
      }
    }
  }
  return scenario;
}

function build(options: ArenaOptions = {}): Game {
  return new Game(arena(options), { enableAI: false });
}

function unit(game: Game, defId: string, owner = 0): Entity {
  const found = game.state.entities.find(
    (e) => e.kind === 'unit' && e.defId === defId && e.owner === owner && e.hp > 0,
  );
  if (!found) throw new Error(`arena has no ${defId} for player ${owner}`);
  return found;
}

function use(game: Game, target: Entity, abilityId: string, team = 0): void {
  game.enqueueCommand({ type: 'useAbility', team, unitId: target.id, abilityId });
  game.tick();
}

const grantsOf = (techId: string): string[] => {
  const tech = techDef(techId);
  if (!tech) throw new Error(`no technology ${techId}`);
  return tech.effects
    .filter((effect) => effect.kind === 'grantUnitUpgrade')
    .map((effect) => (effect as { upgrade: string }).upgrade);
};

const moduleGrantsOf = (techId: string): string[] => {
  const tech = techDef(techId);
  if (!tech) throw new Error(`no technology ${techId}`);
  return tech.effects
    .filter((effect) => effect.kind === 'grantBuildingModule')
    .map((effect) => (effect as { module: string }).module);
};

describe('phase 1 ability catalogue', () => {
  it('resolves every playable ability through one researched upgrade and a real slot', () => {
    for (const def of Object.values(UNIT_ABILITIES)) {
      const upgrade = unitUpgradeDef(def.upgradeId);
      expect(upgrade, def.upgradeId).toBeDefined();
      expect(upgrade!.eligibleSlots.length).toBeGreaterThan(0);
      for (const slot of upgrade!.eligibleSlots) {
        // A slot that is not its own canonical family would silently offer the
        // ability to nobody, or to a hull it does not belong on.
        expect(unitFamily(slot), slot).toBe(slot);
      }
      const granting = RESEARCH.techs.filter((tech) =>
        tech.effects.some(
          (effect) => effect.kind === 'grantUnitUpgrade' && effect.upgrade === def.upgradeId,
        ),
      );
      expect(granting, `${def.upgradeId} is granted once`).toHaveLength(1);
      expect(def.durationSeconds).toBeGreaterThan(0);
      expect(def.cooldownSeconds).toBeGreaterThanOrEqual(def.durationSeconds);
    }
    // The shipped smoke is preserved exactly, not re-implemented.
    expect(UNIT_ABILITIES.reconSmokescreen).toMatchObject({ kind: 'smoke', radius: SMOKE_RADIUS_TILES });
    expect(abilityForUpgrade('reconSmokescreen')!.name).toBe('Recon Smokescreen');
  });

  it('places each new capability on its doctrinal node and keeps the two-tier tree', () => {
    expect(grantsOf('manoeuvre1')).toEqual(
      expect.arrayContaining(['reconSmokescreen', 'emergencyPower']),
    );
    expect(grantsOf('manoeuvre2')).toEqual(expect.arrayContaining(['hullDown', 'apsBurst']));
    expect(grantsOf('fires1')).toContain('firePreparation');
    expect(grantsOf('air2')).toContain('countermeasures');
    expect(grantsOf('naval1')).toContain('sonarSweep');
    expect(techDef('manoeuvre2')!.requires).toEqual(['manoeuvre1']);
    expect(techDef('fires2')!.requires).toEqual(['fires1']);
    // Modules ride the same approved nodes; no ninth technology was added.
    expect(moduleGrantsOf('manoeuvre1')).toEqual(expect.arrayContaining(['advancedTurbine', 'assemblyLine']));
    expect(moduleGrantsOf('fires1')).toContain('fireControlNet');
    expect(moduleGrantsOf('air1')).toContain('flightlineMaintenance');
    expect(moduleGrantsOf('naval1')).toContain('harbourSonar');
    expect(RESEARCH.techs.filter((tech) => !tech.strategic)).toHaveLength(8);
  });

  it('keeps the advanced turbine as one module in the same catalogue', () => {
    expect(BUILDING_MODULES.advancedTurbine.eligibleSlots).toEqual(['powerPlant']);
    expect(installedModuleEffects(['advancedTurbine']).power).toBe(30);
    expect(installedModuleEffects(['assemblyLine']).productionSpeed).toBe(1.25);
    expect(installedModuleEffects(['fireControlNet']).vision).toBe(4);
  });
});

describe('phase 1 ability availability', () => {
  it('offers the manoeuvre abilities only after their node completes', () => {
    // A pre-placed tank grants the technology that unlocks its own slot, so
    // tier one rides on the hull. Tier two is a separate study.
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    expect(abilityActions(game, 0, tank.id).map((action) => action.upgradeId)).toEqual([
      'emergencyPower',
    ]);
    expect(abilityActions(game, 0, tank.id)[0].ready).toBe(true);
    expect(game.abilityStatus(0, tank.id, 'hullDown').reason).toMatch(/not been researched/);

    game.player(0)!.research.completed.push('manoeuvre2');
    expect(abilityActions(game, 0, tank.id).map((action) => action.upgradeId)).toEqual([
      'hullDown',
      'emergencyPower',
      'apsBurst',
    ]);
  });

  it('refuses a hull that cannot carry the ability', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [
        { defId: 'tank', owner: 0, x: 20, z: 20 },
        { defId: 'rifle', owner: 0, x: 24, z: 20 },
      ],
    });
    const rifle = unit(game, 'rifle');
    expect(game.abilityStatus(0, rifle.id, 'hullDown')).toMatchObject({
      ok: false,
    });
    expect(game.abilityStatus(0, rifle.id, 'hullDown').reason).toMatch(/cannot be fitted/);
    expect(abilityActions(game, 0, rifle.id)).toEqual([]);
  });

  it('keeps hard-kill protection off the eastern armour school', () => {
    const western = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      nation: 'poland',
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    expect(western.abilityStatus(0, unit(western, 'tank').id, 'apsBurst').ok).toBe(true);

    const eastern = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      nation: 'russia',
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(eastern, 'tank');
    const denied = eastern.abilityStatus(0, tank.id, 'apsBurst');
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/alliance/);
    // The shared half of the same node still works for both schools.
    expect(eastern.abilityStatus(0, tank.id, 'hullDown').ok).toBe(true);
    expect(eastern.abilityStatus(0, tank.id, 'emergencyPower').ok).toBe(true);
  });

  it('fits the sonar sweep to hulls with a set', () => {
    const game = build({
      technologies: ['naval1'],
      nation: 'sweden',
      water: { x: 16, z: 16, w: 20, h: 10 },
      units: [
        { defId: 'frigate', owner: 0, x: 20, z: 20 },
        { defId: 'rifle', owner: 0, x: 20, z: 28 },
      ],
    });
    expect(game.abilityStatus(0, unit(game, 'frigate').id, 'sonarSweep').ok).toBe(true);
    expect(game.abilityStatus(0, unit(game, 'rifle').id, 'sonarSweep').reason).toMatch(
      /cannot be fitted/,
    );
  });
});

describe('phase 1 timed effects', () => {
  it('halves direct fire but not the indirect round that arcs over the ramp', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    use(game, tank, 'hullDown');
    expect(game.incomingDamageMultiplier(tank, 'tankGun')).toBeCloseTo(0.5, 6);
    expect(game.incomingDamageMultiplier(tank, 'atgm')).toBeCloseTo(0.5, 6);
    expect(game.incomingDamageMultiplier(tank, 'howitzer')).toBe(1);
    expect(game.incomingDamageMultiplier(tank, undefined)).toBe(1);
  });

  it('answers guided ordnance only with a hard-kill burst', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    use(game, tank, 'apsBurst');
    expect(game.incomingDamageMultiplier(tank, 'atgm')).toBeCloseTo(0.3, 6);
    expect(game.incomingDamageMultiplier(tank, 'torpedo')).toBeCloseTo(0.3, 6);
    expect(game.incomingDamageMultiplier(tank, 'tankGun')).toBe(1);
    expect(game.incomingDamageMultiplier(tank, 'rifle')).toBe(1);
  });

  it('cuts anti-aircraft fire, not a rifle', () => {
    const game = build({
      technologies: ['air1', 'air2'],
      units: [{ defId: 'fighter', owner: 0, x: 20, z: 20 }],
    });
    const fighter = unit(game, 'fighter');
    use(game, fighter, 'countermeasures');
    expect(game.incomingDamageMultiplier(fighter, 'samVehicle')).toBeCloseTo(0.4, 6);
    expect(game.incomingDamageMultiplier(fighter, 'rifle')).toBe(1);
  });

  it('pins a hull-down crew in place and releases it when the posture ends', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    const startX = tank.x;
    use(game, tank, 'hullDown');
    // One tick has already run, so the posture has most of its eight seconds.
    expect(game.effectRemaining(tank.id, 'hullDown')).toBeGreaterThan(7.5);
    expect(game.effectRemaining(tank.id, 'hullDown')).toBeLessThanOrEqual(8);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 34 * TILE_SIZE,
      z: 20 * TILE_SIZE,
    });
    game.advance(TICK_RATE * 2);
    expect(Math.abs(tank.x - startX)).toBeLessThan(TILE_SIZE * 0.5);

    game.advance(TICK_RATE * 7);
    expect(game.effectRemaining(tank.id, 'hullDown')).toBe(0);
    expect(Math.abs(tank.x - startX)).toBeGreaterThan(TILE_SIZE);
  });

  it('spends emergency power on speed and nothing else', () => {
    const moved = (boosted: boolean): number => {
      const game = build({
        technologies: ['manoeuvre1'],
        units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
      });
      const tank = unit(game, 'tank');
      if (boosted) use(game, tank, 'emergencyPower');
      const startX = tank.x;
      game.enqueueCommand({
        type: 'move',
        team: 0,
        ids: [tank.id],
        x: 36 * TILE_SIZE,
        z: 20 * TILE_SIZE,
      });
      game.advance(TICK_RATE * 3);
      return Math.abs(tank.x - startX);
    };
    expect(moved(true)).toBeGreaterThan(moved(false) * 1.2);
  });

  it('runs on the simulation clock, not a browser timer', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    use(game, tank, 'hullDown');
    const cooldown = game.cooldownRemaining(tank.id, 'hullDown');
    expect(cooldown).toBeGreaterThan(39.5);
    expect(cooldown).toBeLessThanOrEqual(40);
    expect(game.abilityStatus(0, tank.id, 'hullDown').reason).toMatch(/reloading/);

    game.advance(TICK_RATE);
    // Exactly one simulation second, measured against the fixed tick clock.
    expect(cooldown - game.cooldownRemaining(tank.id, 'hullDown')).toBeCloseTo(1, 3);
    expect(game.effectRemaining(tank.id, 'hullDown')).toBeGreaterThan(6.5);
    expect(game.effectRemaining(tank.id, 'hullDown')).toBeLessThan(7);

    game.advance(TICK_RATE * 8);
    expect(game.effectRemaining(tank.id, 'hullDown')).toBe(0);
    expect(game.incomingDamageMultiplier(tank, 'tankGun')).toBe(1);
  });

  it('exposes a dived boat inside the ping and leaves it hidden outside it', () => {
    const game = build({
      technologies: ['naval1'],
      nation: 'sweden',
      fog: true,
      water: { x: 16, z: 16, w: 20, h: 12 },
      units: [
        { defId: 'frigate', owner: 0, x: 20, z: 20 },
        { defId: 'submarine', owner: 1, x: 33, z: 20 },
      ],
    });
    const frigate = unit(game, 'frigate');
    const boat = unit(game, 'submarine', 1);
    game.enqueueCommand({ type: 'dive', team: 1, ids: [boat.id], dive: true });
    game.advance(VISION_INTERVAL + 1);
    expect(boat.submarine!.dived).toBe(true);
    // Thirteen tiles out: beyond the frigate's passive set, so the boat is gone.
    expect(game.isVisibleTo(0, boat.id)).toBe(false);

    use(game, frigate, 'sonarSweep');
    expect(boat.submarine!.revealed).toBe(true);
    expect(game.isVisibleTo(0, boat.id)).toBe(true);
    expect(game.effectRemaining(frigate.id, 'sonarSweep')).toBeGreaterThan(9.5);
    expect(game.effectRemaining(frigate.id, 'sonarSweep')).toBeLessThanOrEqual(10);
  });

  it('shortens the reload of a prepared battery', () => {
    const shells = (prepared: boolean): number => {
      const game = build({
        technologies: ['fires1'],
        // A static hostile post nine tiles out is inside the howitzer's reach
        // and outside its minimum range, so the battery has a mission.
        structures: [{ defId: 'commandPost', owner: 1, x: 29, z: 20 }],
        units: [{ defId: 'spg', owner: 0, x: 20, z: 20 }],
      });
      const spg = unit(game, 'spg');
      if (prepared) use(game, spg, 'firePreparation');
      const seen = new Set<number>();
      for (let i = 0; i < TICK_RATE * 12; i++) {
        game.tick();
        for (const projectile of game.state.projectiles) {
          if (projectile.shooterId === spg.id) seen.add(projectile.id);
        }
      }
      return seen.size;
    };
    expect(shells(true)).toBeGreaterThan(shells(false));
  });
});

describe('phase 1 save, load and multiplayer', () => {
  it('carries an active effect through a save and never lets it exceed its duration', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    use(game, tank, 'hullDown');
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const loaded = Game.fromSave(save, { enableAI: false });
    expect(loaded.effectRemaining(tank.id, 'hullDown')).toBeGreaterThan(7.5);
    expect(loaded.effectRemaining(tank.id, 'hullDown')).toBeLessThanOrEqual(8);
    expect(loaded.incomingDamageMultiplier(loaded.getEntity(tank.id)!, 'tankGun')).toBeCloseTo(0.5, 6);

    const edited = JSON.parse(JSON.stringify(save));
    const record = edited.state.entities.find((e: { id: number }) => e.id === tank.id);
    record.effects = { hullDown: 999 };
    const clamped = Game.fromSave(edited, { enableAI: false });
    expect(clamped.effectRemaining(tank.id, 'hullDown')).toBeLessThanOrEqual(8);

    game.advance(TICK_RATE * 9);
    const after = JSON.parse(JSON.stringify(game.toSave()));
    const expired = after.state.entities.find((e: { id: number }) => e.id === tank.id);
    expect(expired.effects).toBeUndefined();
  });

  it('accepts a legal activation through the gate and refuses a reload or a foreign hull', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [
        { defId: 'tank', owner: 0, x: 20, z: 20 },
        { defId: 'tank', owner: 1, x: 150, z: 150 },
      ],
    });
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
    const own = unit(game, 'tank');
    const enemy = unit(game, 'tank', 1);
    const envelope = (command: unknown) => ({ v: 1, command });

    expect(
      gate.submit(0, envelope({ type: 'useAbility', unitId: enemy.id, abilityId: 'hullDown' }), 1000),
    ).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(
      gate.submit(0, envelope({ type: 'useAbility', unitId: own.id, abilityId: 'sonarSweep' }), 1100),
    ).toMatchObject({ ok: false, code: 'upgrade-unavailable' });

    const accepted = gate.submit(
      0,
      envelope({ type: 'useAbility', unitId: own.id, abilityId: 'hullDown' }),
      1200,
    );
    expect(accepted.ok).toBe(true);
    game.tick();
    expect(game.effectRemaining(own.id, 'hullDown')).toBeGreaterThan(0);
    // The reload is the hull's own, and the gate reads it from the simulation.
    expect(
      gate.submit(0, envelope({ type: 'useAbility', unitId: own.id, abilityId: 'hullDown' }), 1300),
    ).toMatchObject({ ok: false, code: 'upgrade-unavailable' });
  });

  it('replicates the effect to its owner and keeps it off the opposing team', () => {
    const game = build({
      technologies: ['manoeuvre1', 'manoeuvre2'],
      units: [{ defId: 'tank', owner: 0, x: 20, z: 20 }],
    });
    const tank = unit(game, 'tank');
    use(game, tank, 'hullDown');
    const snapshot = createTeamSnapshot(game, 0);
    expect(snapshot.entities.find((e) => e.id === tank.id)!.effects).toMatchObject({
      hullDown: expect.any(Number),
    });
    const enemy = createTeamState(game, 1, 0);
    expect(enemy.entities.find((e) => e.id === tank.id)?.effects).toBeUndefined();

    const assembler = new SnapshotAssembler({ roomId: 'phase1-abilities', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: snapshot.tick,
        team: 0,
        roomId: 'phase1-abilities',
        checkpoint: true,
        state: snapshot,
      }).ok,
    ).toBe(true);
    expect(
      assembler.state()!.entities.find((e) => e.id === tank.id)!.effects!.hullDown,
    ).toBeGreaterThan(0);
  });
});

describe('phase 1 AI use', () => {
  it('takes a hull-down posture when its armour is under fire', () => {
    const game = build({
      ai: true,
      enemyTechnologies: ['manoeuvre1', 'manoeuvre2'],
      units: [
        { defId: 'tank', owner: 1, x: 40, z: 20 },
        { defId: 'rifle', owner: 0, x: 45, z: 20 },
      ],
    });
    const ai = new AIController();
    const state = initialAIState(7, 'veteran');
    game.advance(TICK_RATE);
    expect(game.getEntity(unit(game, 'tank', 1).id)!.lastHitTick).toBeGreaterThan(0);
    ai.update(game, 1, state);
    const used = game.pending.find((command) => command.type === 'useAbility');
    expect(used).toMatchObject({ abilityId: 'hullDown' });
  });

  it('keeps the dischargers and postures stowed without a sighting', () => {
    const game = build({
      ai: true,
      fog: true,
      enemyTechnologies: ['manoeuvre1', 'manoeuvre2'],
      units: [
        { defId: 'tank', owner: 1, x: 20, z: 30 },
        { defId: 'rifle', owner: 0, x: 44, z: 44 },
      ],
    });
    const ai = new AIController();
    game.advance(TICK_RATE);
    ai.update(game, 1, initialAIState(7, 'veteran'));
    expect(game.pending.some((command) => command.type === 'useAbility')).toBe(false);
  });

  it('installs a researched module on a strained base and only once', () => {
    const scenario = arena({
      ai: true,
      enemyTechnologies: ['manoeuvre1'],
      structures: [
        // A base with no generation and several draws is what makes the AI
        // spend on retrofits at all; a comfortable grid defers them by design.
        { defId: 'factory', owner: 1, x: 40, z: 28 },
        { defId: 'researchCentre', owner: 1, x: 36, z: 28 },
        { defId: 'refinery', owner: 1, x: 44, z: 34 },
        { defId: 'airfield', owner: 1, x: 44, z: 24 },
        { defId: 'shipyard', owner: 1, x: 36, z: 34 },
      ],
      units: Array.from({ length: 12 }, (_, i) => ({
        defId: 'rifle',
        owner: 1,
        x: 34 + (i % 4) * 2,
        z: 38 + Math.floor(i / 4) * 2,
      })),
    });
    const game = new Game(scenario, { enableAI: false });
    game.advance(TICK_RATE);
    const ai = new AIController();
    const state = initialAIState(11, 'veteran');
    ai.update(game, 1, state);
    const install = game.pending.find((command) => command.type === 'installModule');
    expect(install).toMatchObject({ moduleId: 'assemblyLine' });
  });
});

describe('phase 1 building modules', () => {
  it('offers the assembly line only on a factory and only after research', () => {
    const locked = build({
      structures: [
        { defId: 'factory', owner: 0, x: 20, z: 24 },
        { defId: 'powerPlant', owner: 0, x: 26, z: 24 },
      ],
    });
    const factory = locked.state.entities.find((e) => e.defId === 'factory' && e.owner === 0)!;
    const plant = locked.state.entities.find((e) => e.defId === 'powerPlant' && e.owner === 0)!;
    expect(moduleActions(locked, 0, factory.id)).toEqual([]);

    locked.player(0)!.research.completed.push('manoeuvre1');
    expect(locked.moduleStatus(0, factory.id, 'assemblyLine').ok).toBe(true);
    expect(moduleActions(locked, 0, factory.id).map((action) => action.moduleId)).toEqual([
      'assemblyLine',
    ]);
    expect(locked.moduleStatus(0, plant.id, 'assemblyLine').reason).toMatch(/cannot be fitted/);
  });

  it('charges once, installs once and caps at capacity', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'factory', owner: 0, x: 20, z: 24 }],
    });
    const factory = game.state.entities.find((e) => e.defId === 'factory' && e.owner === 0)!;
    const before = game.player(0)!.mats;
    game.enqueueCommand({
      type: 'installModule',
      team: 0,
      buildingId: factory.id,
      moduleId: 'assemblyLine',
    });
    game.tick();
    expect(factory.modules).toEqual(['assemblyLine']);
    // The tick also pays the headquarters trickle, so the charge is measured as
    // an interval rather than against an exact post-tick bank.
    const charged = before - game.player(0)!.mats;
    expect(charged).toBeCloseTo(BUILDING_MODULES.assemblyLine.cost.mats, 0);
    expect(game.moduleStatus(0, factory.id, 'assemblyLine').ok).toBe(false);
    expect(game.moduleStatus(0, factory.id, 'assemblyLine').reason).toMatch(/already installed/);

    // A second (late counterpart) attempt is refused and charges nothing.
    const after = game.player(0)!.mats;
    game.enqueueCommand({
      type: 'installModule',
      team: 0,
      buildingId: factory.id,
      moduleId: 'assemblyLine',
    });
    game.tick();
    // Only the headquarters trickle moved the bank; the refusal charged nothing.
    expect(game.player(0)!.mats - after).toBeLessThan(1);
    expect(game.installedModules(factory.id)).toEqual(['assemblyLine']);
  });

  it('actually shortens a production run by a quarter', () => {
    const remaining = (withModule: boolean): number => {
      const game = build({ structures: [{ defId: 'factory', owner: 0, x: 20, z: 24 }] });
      const factory = game.state.entities.find((e) => e.defId === 'factory' && e.owner === 0)!;
      if (withModule) factory.modules = ['assemblyLine'];
      game.player(0)!.mats = 3000;
      game.enqueueCommand({
        type: 'produce',
        team: 0,
        buildingId: factory.id,
        defId: 'engineer',
      });
      game.advance(TICK_RATE * 2);
      expect(factory.queue).toHaveLength(1);
      return factory.queue[0].remaining;
    };
    const base = remaining(false);
    const boosted = remaining(true);
    expect(base - boosted).toBeGreaterThan(0.2);
  });

  it('unlocks the radar, airfield and harbour modules at their own nodes', () => {
    const game = build({
      technologies: ['fires1', 'air1', 'naval1'],
      structures: [
        { defId: 'radar', owner: 0, x: 20, z: 24 },
        { defId: 'airfield', owner: 0, x: 26, z: 24 },
        { defId: 'shipyard', owner: 0, x: 20, z: 36 },
      ],
    });
    const radar = game.state.entities.find((e) => e.defId === 'radar' && e.owner === 0)!;
    const airfield = game.state.entities.find((e) => e.defId === 'airfield' && e.owner === 0)!;
    const yard = game.state.entities.find((e) => e.defId === 'shipyard' && e.owner === 0)!;
    expect(game.moduleStatus(0, radar.id, 'fireControlNet').ok).toBe(true);
    expect(game.moduleStatus(0, airfield.id, 'flightlineMaintenance').ok).toBe(true);
    expect(game.moduleStatus(0, yard.id, 'harbourSonar').ok).toBe(true);
    // The shared turbine path is still intact on the same tree.
    expect(techDef('manoeuvre1')!.effects).toEqual(
      expect.arrayContaining([{ kind: 'grantBuildingModule', module: 'advancedTurbine' }]),
    );
  });
});
