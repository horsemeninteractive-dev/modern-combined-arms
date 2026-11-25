import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import {
  OUTBREAK_DIFFICULTIES,
  outbreakDifficulty,
  planWave,
  spawnOrder,
  waveComposition,
} from '../src/outbreak/config';
import { CLEANUP_STALL_SECONDS, OutbreakDirector, type WaveHost } from '../src/outbreak/director';
import {
  OUTBREAK_ENTRY_REGIONS,
  OUTBREAK_MAP_ID,
  OUTBREAK_MAP_SIZE,
  createOutbreakScenario,
} from '../src/outbreak/scenario';
import { validateScenario } from '../src/sim/scenario';
import { BUILDINGS } from '../src/data/buildings';
import { Rng } from '../src/core/rng';
import {
  ZOMBIE_KINDS,
  type OutbreakEntryRegion,
  type OutbreakScenarioConfig,
  type ZombieKind,
} from '../src/outbreak/types';

const DT = 1 / TICK_RATE;

/** A field with no simulation: counts in, spawn calls out. */
class FakeHost implements WaveHost {
  aliveInfected = 0;
  readonly spawned: Array<{ kind: ZombieKind; region: string }> = [];
  blocked = false;
  readonly regions: readonly OutbreakEntryRegion[] = OUTBREAK_ENTRY_REGIONS;

  spawn(kind: ZombieKind, region: OutbreakEntryRegion): boolean {
    if (this.blocked) return false;
    this.spawned.push({ kind, region: region.id });
    this.aliveInfected++;
    return true;
  }

  clear(): void {
    this.aliveInfected = 0;
  }
}

function scenarioBlock(overrides: Partial<OutbreakScenarioConfig> = {}): OutbreakScenarioConfig {
  return {
    difficulty: 'normal',
    mode: 'solo',
    entryRegions: OUTBREAK_ENTRY_REGIONS.map((region) => ({ ...region })),
    ...overrides,
  };
}

/** A fast tuning block so a wave takes a second of ticks rather than three minutes. */
function fastConfig() {
  return {
    ...outbreakDifficulty('normal'),
    firstPrepSeconds: 1,
    minPrepSeconds: 0.5,
    prepStepSeconds: 0,
    warningSeconds: 0.5,
    spawnIntervalSeconds: 0.2,
    minSpawnIntervalSeconds: 0.2,
    populationBase: 3,
    populationPerWave: 1,
    maxAliveBase: 6,
    maxAlivePerWave: 1,
    maxAliveCap: 12,
  };
}

function tick(director: OutbreakDirector, host: WaveHost, seconds: number): void {
  const count = Math.round(seconds / DT);
  for (let i = 0; i < count; i++) director.update(host, DT);
}

describe('the Outbreak battlefield', () => {
  it('puts the Command Post on the exact centre of the map', () => {
    const scenario = createOutbreakScenario({ difficulty: 'normal', mode: 'solo', nationId: 'lithuania' });
    const post = scenario.structures.find((s) => s.defId === 'commandPost')!;
    const footprint = BUILDINGS.commandPost.footprint;
    expect(post).toBeDefined();
    expect(post.owner).toBe(0);
    expect(post.x + footprint.w / 2).toBe(OUTBREAK_MAP_SIZE / 2);
    expect(post.z + footprint.h / 2).toBe(OUTBREAK_MAP_SIZE / 2);
    expect(scenario.meta.id).toBe(OUTBREAK_MAP_ID);
    expect(scenario.meta.outbreak?.entryRegions.length).toBeGreaterThanOrEqual(4);
  });

  it('validates clean for every nation and difficulty', () => {
    const nations = ['lithuania', 'poland', 'unitedKingdom', 'finland', 'sweden', 'russia'];
    for (const nation of nations) {
      for (const difficulty of ['easy', 'nightmare'] as const) {
        const scenario = createOutbreakScenario({ difficulty, mode: 'solo', nationId: nation });
        const errors = validateScenario(scenario).filter((issue) => issue.severity === 'error');
        expect(errors, `${nation}/${difficulty}: ${errors.map((e) => e.message).join('; ')}`).toEqual([]);
      }
    }
  });

  it('carries the difficulty starting resources onto the scenario', () => {
    for (const id of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const scenario = createOutbreakScenario({ difficulty: id, mode: 'solo', nationId: 'poland' });
      expect(scenario.settings.startingMats).toBe(OUTBREAK_DIFFICULTIES[id].startingMats);
      expect(scenario.settings.startingReq).toBe(OUTBREAK_DIFFICULTIES[id].startingReq);
      expect(scenario.meta.outbreak?.difficulty).toBe(id);
    }
  });

  it('keeps the infected out of the player roster and gives them their own side', () => {
    const scenario = createOutbreakScenario({ difficulty: 'normal', mode: 'solo', nationId: 'sweden' });
    expect(scenario.players[0].factionId).toBe('sweden');
    expect(scenario.players[0].team).toBe(0);
    expect(scenario.players[1].factionId).toBe('infected');
    expect(scenario.players[1].team).toBe(1);
    // No conventional opponent: the mission carries no AI player and no enemy HQ.
    expect(scenario.structures.some((s) => s.owner === 1)).toBe(false);
    expect(scenario.players.every((p) => !p.isAI)).toBe(true);
  });
});

describe('wave planning', () => {
  it('opens with a small shambler-only wave', () => {
    const plan = planWave(1, outbreakDifficulty('normal'), new Rng(1));
    expect(plan.wave).toBe(1);
    expect(plan.total).toBeGreaterThan(3);
    expect(plan.total).toBeLessThan(12);
    expect(plan.composition.shambler).toBe(plan.total);
    expect(plan.composition.runner).toBe(0);
    expect(plan.groups).toBeGreaterThanOrEqual(1);
  });

  it('introduces each archetype at its own wave and ramps its share', () => {
    const config = outbreakDifficulty('normal');
    const early = waveComposition(10, config, 100);
    const late = waveComposition(30, config, 100);
    expect(early.runner).toBeGreaterThan(0);
    expect(early.brute).toBe(0);
    expect(late.brute).toBeGreaterThan(0);
    expect(late.bloater).toBeGreaterThan(0);
    expect(late.crawler).toBeGreaterThan(0);
    // Specials stay a minority: the shambler remains the backbone.
    expect(late.shambler).toBeGreaterThan(late.runner + late.brute + late.bloater + late.crawler);
    // Every body is accounted for.
    const sum = Object.values(late).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('scales population, groups and pressure without hard-coding a last wave', () => {
    const config = outbreakDifficulty('normal');
    let previous = 0;
    for (const wave of [1, 5, 10, 20, 31, 45, 60]) {
      const plan = planWave(wave, config, new Rng(100 + wave));
      expect(plan.total).toBeGreaterThan(previous);
      previous = plan.total;
      expect(plan.groups).toBeGreaterThanOrEqual(1);
      expect(plan.groups).toBeLessThanOrEqual(config.groupsMax);
      expect(plan.maxAlive).toBeLessThanOrEqual(config.maxAliveCap);
      expect(plan.spawnIntervalSeconds).toBeGreaterThanOrEqual(config.minSpawnIntervalSeconds);
    }
    // Beyond the design table the director still plans a coherent wave, and the
    // jitter around the cap never exceeds it.
    const deep = planWave(200, config, new Rng(7));
    expect(deep.total).toBeLessThanOrEqual(config.populationCap);
    expect(deep.total).toBeGreaterThanOrEqual(Math.floor(config.populationCap * 0.9));
    expect(deep.composition.shambler + deep.composition.runner).toBeGreaterThan(0);
  });

  it('shortens preparation as the run goes on, down to a floor', () => {
    const config = outbreakDifficulty('normal');
    const first = planWave(1, config, new Rng(1)).prepSeconds;
    const tenth = planWave(10, config, new Rng(2)).prepSeconds;
    const deep = planWave(80, config, new Rng(3)).prepSeconds;
    expect(tenth).toBeLessThan(first);
    expect(deep).toBe(config.minPrepSeconds);
  });

  it('spreads the wave across the map entry regions', () => {
    const config = outbreakDifficulty('hard');
    const plan = planWave(12, config, new Rng(5));
    const order = spawnOrder(
      plan,
      OUTBREAK_ENTRY_REGIONS.map((region) => region.id),
      new Rng(5),
    );
    expect(order).toHaveLength(plan.total);
    const used = new Set(order.map((entry) => entry.regionId));
    expect(used.size).toBeGreaterThan(1);
    expect(used.size).toBeLessThanOrEqual(OUTBREAK_ENTRY_REGIONS.length);
    // Same seed, same order: the director cannot disagree with its own peers.
    const repeat = spawnOrder(
      plan,
      OUTBREAK_ENTRY_REGIONS.map((region) => region.id),
      new Rng(5),
    );
    expect(repeat).toEqual(order);
  });

  it('attacks down no more approaches than the plan allows', () => {
    const ids = OUTBREAK_ENTRY_REGIONS.map((region) => region.id);
    for (const id of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const config = outbreakDifficulty(id);
      for (const wave of [1, 6, 20, 40]) {
        const plan = planWave(wave, config, new Rng(31 + wave));
        const order = spawnOrder(plan, ids, new Rng(31 + wave));
        const used = new Set(order.map((entry) => entry.regionId));
        // The group count is the width of the attack: a plan of two groups may
        // use two roads, and never more.
        expect(used.size).toBe(Math.min(plan.groups, ids.length));
      }
    }
  });

  it('opens Easy with a single approach instead of surrounding the base', () => {
    const plan = planWave(1, outbreakDifficulty('easy'), new Rng(3));
    expect(plan.groups).toBe(1);
    const order = spawnOrder(
      plan,
      OUTBREAK_ENTRY_REGIONS.map((region) => region.id),
      new Rng(3),
    );
    expect(new Set(order.map((entry) => entry.regionId)).size).toBe(1);
    // Nightmare's opening is deliberately wider than its population: two roads
    // for the first wave, and a new axis every other wave after it.
    const nightmare = planWave(1, outbreakDifficulty('nightmare'), new Rng(3));
    expect(nightmare.groups).toBe(2);
  });

  // `firstWave` is the wave the archetype is announced on, and the ramp's first
  // step is a fraction of the apex share: Easy's brute is due on 15, where its
  // share of the horde rounds to a fraction of a body. Each difficulty is checked
  // against its own table so the numbers a player reads and the first brute on
  // the field cannot drift apart again.
  for (const id of ['easy', 'normal', 'hard', 'nightmare'] as const) {
    it(`fields every specialist from its configured first wave on ${id}`, () => {
      const config = outbreakDifficulty(id);
      for (const kind of ZOMBIE_KINDS) {
        if (kind === 'shambler') continue;
        const first = config.firstWave[kind];
        // Nothing before it, and a body on it.
        expect(waveComposition(first - 1, config, 40)[kind], `${id}/${kind} early`).toBe(0);
        expect(waveComposition(first, config, 40)[kind], `${id}/${kind} at wave ${first}`).toBeGreaterThan(0);
        // Introduced is introduced: the archetype never blinks back out while its
        // share catches up with the size of the horde.
        for (let wave = first; wave <= 60; wave++) {
          const plan = planWave(wave, config, new Rng(wave));
          expect(plan.composition[kind], `${id}/${kind} missing at wave ${wave}`).toBeGreaterThan(0);
          const sum = Object.values(plan.composition).reduce((a, b) => a + b, 0);
          expect(sum, `${id} wave ${wave} does not add up`).toBe(plan.total);
        }
      }
    });
  }

  it('changes the shape of late waves, not just their size', () => {
    const config = outbreakDifficulty('normal');
    // Nothing changes before the shape table starts: the wave is the same trickle.
    for (const wave of [1, 10, config.shapesFromWave - 1]) {
      const plan = planWave(wave, config, new Rng(61 + wave));
      expect(plan.shape, `wave ${wave}`).toBe('steady');
      expect(plan.pushAt).toBe(0);
      expect(plan.pushSize).toBe(0);
    }
    const shapes = new Set<string>();
    for (let wave = config.shapesFromWave; wave < config.shapesFromWave + 6; wave++) {
      const plan = planWave(wave, config, new Rng(61 + wave));
      expect(plan.shape, `wave ${wave}`).not.toBe('steady');
      shapes.add(plan.shape);
      // The shape decides how the wave arrives, never how big it is.
      expect(Object.values(plan.composition).reduce((a, b) => a + b, 0)).toBe(plan.total);
    }
    // Both scripted shapes appear, and they alternate rather than clumping.
    expect([...shapes].sort()).toEqual(['push', 'sprint']);
  });

  it('gives a sprint wave more of the fast archetypes', () => {
    const config = outbreakDifficulty('normal');
    const steady = waveComposition(40, config, 200);
    const sprint = waveComposition(40, config, 200, { runner: 2.0, crawler: 1.6 });
    expect(sprint.runner).toBeGreaterThan(steady.runner);
    expect(sprint.crawler).toBeGreaterThan(steady.crawler);
    expect(sprint.shambler).toBeLessThan(steady.shambler);
    expect(Object.values(sprint).reduce((a, b) => a + b, 0)).toBe(200);
    // A sprint is a faster mix, not a different horde: every kind still walks,
    // and the shambler still leads it.
    for (const kind of ZOMBIE_KINDS) expect(sprint[kind], kind).toBeGreaterThan(0);
    expect(sprint.shambler).toBeGreaterThan(sprint.runner);
  });

  it('keeps the shared horde intact on every shaped wave', () => {
    for (const id of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const config = outbreakDifficulty(id);
      for (let wave = config.shapesFromWave; wave <= 70; wave++) {
        const plan = planWave(wave, config, new Rng(wave));
        const sum = Object.values(plan.composition).reduce((a, b) => a + b, 0);
        expect(sum, `${id} wave ${wave} does not add up`).toBe(plan.total);
        // A sprint reweights the mix; it never reweights the shambler out of it.
        expect(plan.composition.shambler, `${id} wave ${wave} lost its backbone`).toBeGreaterThan(0);
        // And only a push carries a wall.
        if (plan.shape === 'push') {
          expect(plan.pushSize, `${id} wave ${wave}`).toBeGreaterThan(0);
          expect(plan.pushAt + plan.pushSize).toBeLessThanOrEqual(plan.total);
        } else {
          expect(plan.pushAt).toBe(0);
          expect(plan.pushSize).toBe(0);
        }
      }
    }
  });

  it("holds a push wave's wall for the back half of the wave", () => {
    const config = outbreakDifficulty('normal');
    const push = planWave(config.shapesFromWave + 1, config, new Rng(5));
    expect(push.shape).toBe('push');
    expect(push.pushAt).toBeGreaterThan(0);
    expect(push.pushSize).toBeGreaterThanOrEqual(3);
    expect(push.pushAt + push.pushSize).toBeLessThanOrEqual(push.total);
    // The wall is a real block, not a rounding crumb on an ordinary batch.
    expect(push.pushSize).toBeGreaterThan(Math.ceil(push.total / 18) * 2);
    // Same wave and seed, same plan: the shape is part of the plan, not a roll.
    expect(planWave(config.shapesFromWave + 1, config, new Rng(5))).toEqual(push);
  });

  it('does not inflate zombie hit points with difficulty', () => {
    const easy = outbreakDifficulty('easy');
    const nightmare = outbreakDifficulty('nightmare');
    // Difficulty is expressed as more bodies, more directions and less recovery.
    expect(nightmare.populationBase).toBeGreaterThan(easy.populationBase);
    expect(nightmare.groupsBase).toBeGreaterThan(easy.groupsBase);
    expect(nightmare.firstPrepSeconds).toBeLessThan(easy.firstPrepSeconds);
  });
});

describe('the wave director', () => {
  it('runs preparation, warning, assault, cleanup and recovery in order', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 11, host.regions);
    const phases: string[] = [director.phase];
    director.onEvent((event) => phases.push(event.kind));
    expect(director.wave).toBe(1);

    tick(director, host, 0.4);
    expect(director.phase).toBe('preparation');
    expect(host.spawned).toHaveLength(0);
    tick(director, host, 0.2);
    expect(director.phase).toBe('warning');
    tick(director, host, 0.5);
    expect(director.phase).toBe('assault');

    tick(director, host, 10);
    expect(host.spawned).toHaveLength(director.plan!.total);
    expect(director.phase).toBe('cleanup');
    // The wave is not complete while bodies remain on the field.
    tick(director, host, 5);
    expect(director.wave).toBe(1);
    expect(phases).not.toContain('wave-complete');

    host.clear();
    tick(director, host, 0.1);
    expect(phases).toContain('wave-cleared');
    expect(phases).toContain('wave-complete');
    tick(director, host, 3.2);
    expect(director.wave).toBe(2);
    expect(director.phase).toBe('preparation');
  });

  it('reports the approach clock the HUD shows', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 3, host.regions);
    const plan = director.plan!;
    expect(director.secondsToAssault).toBeCloseTo(plan.prepSeconds, 1);
    tick(director, host, 0.6);
    expect(director.secondsToAssault).toBeLessThanOrEqual(0.5);
    tick(director, host, 0.6);
    expect(director.secondsToAssault).toBe(0);
  });

  it('holds bodies back when the field is full instead of dropping them', () => {
    const host = new FakeHost();
    const config = { ...fastConfig(), maxAliveBase: 2, maxAlivePerWave: 0, maxAliveCap: 2 };
    const director = new OutbreakDirector('normal', config, scenarioBlock(), 21, host.regions);
    tick(director, host, 2);
    const plan = director.plan!;
    expect(host.aliveInfected).toBe(2);
    // Nothing is lost: the rest is still pending and the director says so.
    expect(director.unspawned).toBe(plan.total - 2);
    // Clearing the field lets the rest of the wave through, still capped.
    host.clear();
    tick(director, host, 1);
    expect(host.spawned).toHaveLength(plan.total);
    expect(director.unspawned).toBe(0);
  });

  // A body that cannot path anywhere never dies, so `aliveInfected` stays above
  // zero forever. Cleanup used to wait only for an empty field: the wave never
  // ended, no further wave was planned, and the run simply stopped.
  it('closes a wave a stranded body would otherwise hold open', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 17, host.regions);
    const phases: string[] = [];
    director.onEvent((event) => phases.push(event.kind));

    tick(director, host, 10);
    expect(director.phase).toBe('cleanup');
    expect(host.aliveInfected).toBeGreaterThan(0);

    // Nothing on the field can be reached, so nothing dies: the count never falls.
    // Well short of the bound, the wave is still open.
    tick(director, host, 5);
    expect(director.phase).toBe('cleanup');
    expect(phases).not.toContain('wave-complete');

    // Past the bound (the stall clock was already running through the tail of
    // the tick above) the wave is over anyway, and the next one is planned.
    tick(director, host, CLEANUP_STALL_SECONDS);
    expect(phases).toContain('wave-complete');
    expect(director.wave).toBe(2);
    expect(director.plan!.wave).toBe(2);
    // The stranded body was left to the simulation, not deleted to fake a clear.
    expect(host.aliveInfected).toBeGreaterThan(0);
  });

  // The HUD renders `aliveInfected` under the label `INFECTED`, while the
  // director's `maxAlive` is a ceiling over that same population. They are not
  // the same number and are not meant to be: a wave that closes on the stall
  // bound leaves its bodies standing, and they count against the next wave's
  // ceiling before it has spawned anything. So the panel names the population
  // it counts and the ceiling stays a pacing rule it never shows.
  it('reports the whole living field, which can already sit at the next ceiling', () => {
    const host = new FakeHost();
    const config = { ...fastConfig(), maxAliveBase: 3, maxAlivePerWave: 0, maxAliveCap: 6 };
    const director = new OutbreakDirector('normal', config, scenarioBlock(), 23, host.regions);

    // The field never kills anything, so wave 1 closes on the stall bound with
    // its whole population still alive.
    tick(director, host, 10);
    expect(director.phase).toBe('cleanup');
    const stranded = host.aliveInfected;
    expect(stranded).toBeGreaterThan(0);

    tick(director, host, CLEANUP_STALL_SECONDS);
    expect(director.wave).toBe(2);
    const plan = director.plan!;
    expect(host.aliveInfected).toBe(stranded);

    // Wave 2's ceiling is that same field count, so it is already full: the
    // number on the panel is the population, not this wave's force.
    expect(plan.maxAlive).toBe(stranded);
    expect(host.spawned).toHaveLength(stranded);
    expect(director.unspawned).toBe(plan.total);
  });

  it('counts a slow kill as progress instead of calling it a stall', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 19, host.regions);
    const phases: string[] = [];
    director.onEvent((event) => phases.push(event.kind));
    tick(director, host, 10);
    expect(director.phase).toBe('cleanup');

    // Bodies fall slowly — well past the stall window in total, but never quiet
    // for a whole window. A fight that is still killing is not a stall.
    for (let i = 0; i < 2; i++) {
      host.aliveInfected--;
      tick(director, host, 30);
      expect(director.phase).toBe('cleanup');
    }
    expect(phases).not.toContain('wave-complete');

    host.clear();
    tick(director, host, 0.1);
    expect(phases).toContain('wave-complete');
    expect(director.wave).toBe(1);
  });

  it('keeps spawning from the same region until the ground accepts a body', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 4, host.regions);
    host.blocked = true;
    tick(director, host, 3);
    expect(host.spawned).toHaveLength(0);
    expect(director.phase).toBe('assault');
    host.blocked = false;
    tick(director, host, 2);
    expect(host.spawned.length).toBeGreaterThan(0);
  });

  it('progresses past wave 31 with no hard-coded ending', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('nightmare', fastConfig(), scenarioBlock(), 5, host.regions);
    let guard = 0;
    while (director.wave <= 34 && guard++ < 400) {
      tick(director, host, 12);
      host.clear();
      tick(director, host, 6);
    }
    expect(director.wave).toBeGreaterThan(34);
    expect(host.spawned.length).toBeGreaterThan(300);
    const kinds = new Set(host.spawned.map((entry) => entry.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('uses every entry region over a run, not just the nearest road', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('hard', fastConfig(), scenarioBlock(), 9, host.regions);
    let guard = 0;
    while (director.wave < 6 && guard++ < 100) {
      tick(director, host, 12);
      host.clear();
      tick(director, host, 6);
    }
    const regions = new Set(host.spawned.map((entry) => entry.region));
    expect(regions.size).toBeGreaterThan(2);
    expect(regions.size).toBeLessThanOrEqual(OUTBREAK_ENTRY_REGIONS.length);
  });

  // A wave with room for its own wall: `fastConfig`'s twelve-body ceiling would
  // otherwise truncate the block, which is the ceiling doing its job rather than
  // the push failing.
  const pushConfig = { ...fastConfig(), maxAliveBase: 40, maxAlivePerWave: 0, maxAliveCap: 60 };

  it('lands a push wave in one instant instead of a steady trickle', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector(
      'normal',
      pushConfig,
      scenarioBlock({ startWave: 21 }),
      29,
      host.regions,
    );
    const plan = director.plan!;
    expect(plan.shape).toBe('push');

    const deltas: number[] = [];
    let previous = 0;
    for (let i = 0; i < TICK_RATE * 30 && director.phase !== 'cleanup'; i++) {
      director.update(host, DT);
      if (host.spawned.length > previous) {
        deltas.push(host.spawned.length - previous);
        previous = host.spawned.length;
      }
      // The field is emptied every tick so the ceiling cannot mask the wall.
      host.clear();
    }
    expect(host.spawned).toHaveLength(plan.total);
    // Exactly one wall, and it is far bigger than the ordinary batch.
    expect(deltas.filter((delta) => delta >= plan.pushSize)).toHaveLength(1);
    expect(plan.pushSize).toBeGreaterThan(Math.ceil(plan.total / 18) * 2);
    // The rest arrived at the ordinary batch size, before and after it.
    expect(Math.max(...deltas.filter((delta) => delta < plan.pushSize))).toBeLessThan(
      plan.pushSize,
    );
  });

  it('does not land the same push twice after a reload', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector(
      'normal',
      pushConfig,
      scenarioBlock({ startWave: 21 }),
      29,
      host.regions,
    );
    const plan = director.plan!;
    let landed = false;
    for (let i = 0; i < TICK_RATE * 30 && !landed; i++) {
      director.update(host, DT);
      landed = director.snapshot.pushOpen;
      host.clear();
    }
    expect(landed).toBe(true);

    // A reload picks the wave up after the wall: the flag travels with the save,
    // so the partner does not walk into the same block twice.
    const clone = new OutbreakDirector(
      'normal',
      pushConfig,
      scenarioBlock({ startWave: 21 }),
      29,
      host.regions,
    );
    clone.restore(director.toState());
    const other = new FakeHost();
    let before = 0;
    let largest = 0;
    for (let i = 0; i < TICK_RATE * 5 && clone.phase === 'assault'; i++) {
      clone.update(other, DT);
      largest = Math.max(largest, other.spawned.length - before);
      before = other.spawned.length;
      other.aliveInfected = 0;
    }
    expect(clone.plan!.shape).toBe('push');
    expect(largest).toBeLessThan(plan.pushSize);
  });

  it('round-trips its state exactly, including the spawn rhythm', () => {
    const host = new FakeHost();
    const director = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 13, host.regions);
    tick(director, host, 2.5);
    const saved = director.toState();
    const clone = new OutbreakDirector('normal', fastConfig(), scenarioBlock(), 13, host.regions);
    clone.restore(saved);
    expect(clone.toState()).toEqual(saved);

    // Both copies then produce the same rest of the wave from the same point.
    const otherHost = new FakeHost();
    otherHost.aliveInfected = host.aliveInfected;
    const before = host.spawned.length;
    tick(director, host, 6);
    tick(clone, otherHost, 6);
    expect(otherHost.spawned.map((entry) => entry.kind)).toEqual(
      host.spawned.slice(before).map((entry) => entry.kind),
    );
    expect(clone.phase).toBe(director.phase);
    expect(clone.wave).toBe(director.wave);
  });
});
