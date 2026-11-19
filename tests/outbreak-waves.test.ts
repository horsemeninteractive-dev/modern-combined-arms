import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import {
  OUTBREAK_DIFFICULTIES,
  outbreakDifficulty,
  planWave,
  spawnOrder,
  waveComposition,
} from '../src/outbreak/config';
import { OutbreakDirector, type WaveHost } from '../src/outbreak/director';
import {
  OUTBREAK_ENTRY_REGIONS,
  OUTBREAK_MAP_ID,
  OUTBREAK_MAP_SIZE,
  createOutbreakScenario,
} from '../src/outbreak/scenario';
import { validateScenario } from '../src/sim/scenario';
import { BUILDINGS } from '../src/data/buildings';
import { Rng } from '../src/core/rng';
import type { OutbreakEntryRegion, OutbreakScenarioConfig, ZombieKind } from '../src/outbreak/types';

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
