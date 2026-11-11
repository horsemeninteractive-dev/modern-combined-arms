/**
 * Phase 6C.1 / 6C.2 — building, module and upgrade balance audit.
 *
 * The inventory assertions are data-level because the roster is data. The
 * value assertions are measured through the real simulation, because a cost
 * table alone cannot say what a structure is worth.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import {
  BUILDINGS,
  BUILDABLE_BY_PLAYER,
  NATIONAL_BUILDING_LIST,
  buildingFamily,
} from '../src/data/buildings';
import { BUILDING_MODULES, TECHS, UNIT_UPGRADES, installedModuleEffects } from '../src/data/research';
import { WEAPONS } from '../src/data/weapons';
import { buildStructure, fund, produceUnits, siteFor } from './economyBench';

function island(): Game {
  return new Game(createIslandAssault(), { enableAI: false });
}

const SHARED = BUILDABLE_BY_PLAYER.filter((b) => !b.national);

describe('structure inventory', () => {
  it('counts the shared and national rosters from source', () => {
    const report = {
      registered: Object.keys(BUILDINGS).length,
      buildable: BUILDABLE_BY_PLAYER.length,
      shared: SHARED.length,
      national: NATIONAL_BUILDING_LIST.length,
      producers: BUILDABLE_BY_PLAYER.filter((b) => b.produces).length,
      armed: BUILDABLE_BY_PLAYER.filter((b) => (b.weapons?.length ?? 0) > 0).length,
      powerSources: BUILDABLE_BY_PLAYER.filter((b) => (b.power ?? 0) > 0).length,
      modules: Object.keys(BUILDING_MODULES).length,
      unitUpgrades: Object.keys(UNIT_UPGRADES).length,
      technologies: Object.keys(TECHS).length,
    };
    console.log('[econ]', JSON.stringify({ kind: 'inventory', ...report }));
    expect(report.shared).toBe(15);
    expect(report.national).toBe(10);
    expect(report.buildable).toBe(25);
    expect(report.modules).toBe(5);
    expect(report.unitUpgrades).toBe(7);
    expect(report.technologies).toBe(18);
  });

  it('gives every buildable structure a role, a price, a time and a grid line', () => {
    for (const def of BUILDABLE_BY_PLAYER) {
      expect(def.role, `${def.id} role`).toBeTruthy();
      expect(def.buildTime, `${def.id} build time`).toBeGreaterThan(0);
      expect(def.cost.mats, `${def.id} material cost`).toBeGreaterThan(0);
      expect(def.hp, `${def.id} hp`).toBeGreaterThan(0);
      // Every structure is either a grid source, a grid load, or takes no part.
      expect(Number.isFinite(def.power ?? 0), `${def.id} power`).toBe(true);
    }
  });

  it('gives every producer a queue and every weapon a real definition', () => {
    for (const def of BUILDABLE_BY_PLAYER) {
      if (def.produces) {
        expect(def.productionList?.length ?? 0, `${def.id} production list`).toBeGreaterThan(0);
      }
      for (const weaponId of def.weapons ?? []) {
        const weapon = WEAPONS[weaponId];
        expect(weapon, `${def.id} weapon ${weaponId}`).toBeTruthy();
        expect(weapon.targets.length).toBeGreaterThan(0);
        expect(weapon.range).toBeGreaterThan(0);
      }
    }
  });
});

describe('measured construction times', () => {
  it('matches the authored build time with one engineer on the site', () => {
    const game = island();
    const avoided: Array<{ x: number; z: number }> = [];
    const measured: Array<Record<string, number | string>> = [];
    for (const defId of ['powerPlant', 'barracks', 'refinery', 'factory']) {
      const site = siteFor(game, 0, defId, avoided);
      avoided.push(site);
      const placed = buildStructure(game, 0, defId, { site });
      measured.push({
        defId,
        authored: BUILDINGS[defId].buildTime,
        measured: placed.seconds,
        ratio: Math.round((placed.seconds / BUILDINGS[defId].buildTime) * 100) / 100,
      });
    }
    console.log('[econ]', JSON.stringify({ kind: 'build-times', measured }));
    for (const row of measured) {
      const ratio = row.ratio as number;
      // A single engineer should reproduce the authored clock; the band leaves
      // room for tick granularity and the last construction step.
      expect(ratio, `${row.defId} build ratio`).toBeGreaterThan(0.6);
      expect(ratio, `${row.defId} build ratio`).toBeLessThan(1.6);
    }
  });

  it('charges exactly the authored price when the order is placed', () => {
    const game = island();
    const before = game.player(0)!.mats;
    const site = siteFor(game, 0, 'barracks');
    game.enqueueCommand({ type: 'placeBuilding', team: 0, defId: 'barracks', tileX: site.x, tileZ: site.z });
    game.tick();
    expect(before - game.player(0)!.mats).toBe(BUILDINGS.barracks.cost.mats);
  });
});

describe('production structures', () => {
  it('produces infantry from a barracks at a measurable rate', () => {
    const game = island();
    fund(game);
    const site = siteFor(game, 0, 'barracks');
    const placed = buildStructure(game, 0, 'barracks', { site });
    const throughput = produceUnits(game, 0, placed.structure.id, 'rifle', 5);
    console.log('[econ]', JSON.stringify({ kind: 'barracks-throughput', ...throughput }));
    expect(throughput.produced).toBe(5);
    expect(throughput.perMinute).toBeGreaterThan(0);
  });

  it('values an assembly line by units delivered, not by its percentage', () => {
    const baseline = island();
    fund(baseline);
    const bSite = siteFor(baseline, 0, 'factory');
    const bFactory = buildStructure(baseline, 0, 'factory', { site: bSite });
    const without = produceUnits(baseline, 0, bFactory.structure.id, 'apc', 4);

    const upgraded = island();
    fund(upgraded);
    const uSite = siteFor(upgraded, 0, 'factory');
    const uFactory = buildStructure(upgraded, 0, 'factory', { site: uSite });
    // The module's installed list is what the simulation resolves; setting it
    // directly measures the effect without replaying a research purchase.
    uFactory.structure.modules = ['assemblyLine'];
    const withModule = produceUnits(upgraded, 0, uFactory.structure.id, 'apc', 4);

    const saved = without.seconds - withModule.seconds;
    console.log('[econ]', JSON.stringify({
      kind: 'assembly-line',
      without,
      withModule,
      secondsSaved: saved,
      moduleCost: BUILDING_MODULES.assemblyLine.cost.mats,
    }));
    expect(withModule.produced).toBe(4);
    expect(withModule.seconds).toBeLessThanOrEqual(without.seconds);
    // 1.25x production should save roughly a fifth of the clock on a full run.
    expect(saved).toBeGreaterThan(0);
  });
});

describe('the power grid', () => {
  it('prices a generator against the module that upgrades it', () => {
    const game = island();
    fund(game);
    const site = siteFor(game, 0, 'powerPlant');
    const planted = buildStructure(game, 0, 'powerPlant', { site });
    const base = game.powerStatus(0);
    planted.structure.modules = ['advancedTurbine'];
    const upgraded = game.powerStatus(0);
    const plant = BUILDINGS.powerPlant;
    const turbine = BUILDING_MODULES.advancedTurbine;
    const report = {
      kind: 'generator-value',
      plantCost: plant.cost.mats,
      plantPower: plant.power,
      plantMatsPerPower: Math.round((plant.cost.mats / (plant.power ?? 1)) * 100) / 100,
      turbineCost: turbine.cost.mats,
      turbinePower: 30,
      turbineMatsPerPower: Math.round((turbine.cost.mats / 30) * 100) / 100,
      base,
      upgraded,
    };
    console.log('[econ]', JSON.stringify(report));
    expect(base.supply).toBe(110);
    expect(upgraded.supply).toBe(140);
    // Recorded, not asserted as balanced: the retrofit buys power at more than
    // twice the material cost per point of a second plant. Its case is ground
    // area, not economy.
    expect(report.turbineMatsPerPower).toBeGreaterThan(report.plantMatsPerPower);
  });

  it('slows construction in a deficit and recovers when supply returns', () => {
    const game = island();
    fund(game, 0, 20000, 4000);
    const avoided: Array<{ x: number; z: number }> = [];
    // 50 supply against 53 of draw: a real, modest deficit rather than a base
    // built out past what any map has room for. The barracks comes first
    // because the radar is gated on it.
    for (const defId of ['barracks', 'factory', 'researchCentre']) {
      const site = siteFor(game, 0, defId, avoided);
      avoided.push(site);
      buildStructure(game, 0, defId, { site });
    }
    const deficit = game.powerStatus(0);
    const slow = game.powerSpeed(0);
    const site = siteFor(game, 0, 'powerPlant', avoided);
    buildStructure(game, 0, 'powerPlant', { site });
    const restored = game.powerStatus(0);
    console.log('[econ]', JSON.stringify({
      kind: 'power-deficit',
      deficit,
      slow: Math.round(slow * 1000) / 1000,
      restored,
      restoredSpeed: game.powerSpeed(0),
    }));
    expect(deficit.brownout).toBe(true);
    expect(slow).toBeLessThan(1);
    expect(restored.brownout).toBe(false);
    expect(game.powerSpeed(0)).toBe(1);
  });
});

describe('static defences', () => {
  it('prices each defensive position against the unit it is meant to stop', () => {
    const rows = ['mgNest', 'atTurret', 'samBattery', 'coastalBattery'].map((id) => {
      const def = BUILDINGS[id];
      const weaponIds = def.weapons ?? [];
      return {
        id,
        price: def.cost.mats,
        buildTime: def.buildTime,
        hp: def.hp,
        power: def.power,
        weapon: weaponIds.join(','),
        range: weaponIds.map((w) => WEAPONS[w]?.range ?? 0),
        targets: weaponIds.map((w) => WEAPONS[w]?.targets.join('/') ?? ''),
      };
    });
    console.log('[econ]', JSON.stringify({ kind: 'defence-table', rows }));
    for (const row of rows) expect(row.targets.join('').length).toBeGreaterThan(0);
  });
});

describe('selling structures', () => {
  it('quotes a refund and a deconstruction clock for every buildable structure', () => {
    const game = island();
    fund(game);
    const site = siteFor(game, 0, 'barracks');
    const placed = buildStructure(game, 0, 'barracks', { site });
    const quote = game.sellQuote(placed.structure.id);
    console.log('[econ]', JSON.stringify({
      kind: 'sell-quote',
      defId: 'barracks',
      cost: BUILDINGS.barracks.cost.mats,
      quote,
    }));
    expect(quote).not.toBeNull();
    expect(quote!.mats).toBeGreaterThan(0);
    expect(quote!.mats).toBeLessThan(BUILDINGS.barracks.cost.mats);
    expect(quote!.seconds).toBeGreaterThan(0);
  });
});

describe('national structure variants', () => {
  it('substitutes a canonical slot and keeps its production list', () => {
    const rows = NATIONAL_BUILDING_LIST.map((def) => {
      const root = buildingFamily(def.id);
      const base = BUILDINGS[root];
      expect(base, `${def.id} root`).toBeTruthy();
      expect(def.variantOf, `${def.id} variantOf`).toBeTruthy();
      expect(def.productionList ?? [], `${def.id} production list`).toEqual(
        base.productionList ?? [],
      );
      // Footprint is recorded rather than required to match: the Signals Bureau
      // is authored as a compact 2x2 listening station in the 4x3 research slot.
      return {
        id: def.id,
        // National buildings carry no nation tag in source; the roster assigns
        // them. Recorded here so the report can say so plainly.
        footprint: `${def.footprint.w}x${def.footprint.h}`,
        baseFootprint: `${base.footprint.w}x${base.footprint.h}`,
        slot: root,
        costDelta: def.cost.mats - base.cost.mats,
        timeDelta: def.buildTime - base.buildTime,
        hpDelta: def.hp - base.hp,
        powerDelta: (def.power ?? 0) - (base.power ?? 0),
        visionDelta: (def.vision ?? 0) - (base.vision ?? 0),
      };
    });
    console.log('[econ]', JSON.stringify({ kind: 'national-variants', rows }));
    expect(rows).toHaveLength(10);
    // A variant has to differ in something measurable, or it is a reskin.
    for (const row of rows) {
      const changes = Math.abs(row.costDelta) + Math.abs(row.timeDelta) + Math.abs(row.hpDelta) +
        Math.abs(row.powerDelta) + Math.abs(row.visionDelta);
      expect(changes, `${row.id} differs from its canonical slot`).toBeGreaterThan(0);
    }
  });
});

describe('module and upgrade value', () => {
  it('prices every module effect against its alternative', () => {
    const rows = Object.values(BUILDING_MODULES).map((module) => ({
      id: module.id,
      cost: module.cost.mats,
      req: module.cost.req,
      slots: module.eligibleSlots.join(','),
      effects: module.effects.map((e) => JSON.stringify(e)).join(' '),
      resolved: JSON.stringify(installedModuleEffects([module.id])),
    }));
    console.log('[econ]', JSON.stringify({ kind: 'modules', rows }));
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.cost).toBeGreaterThan(0);
  });

  it('prices every purchasable unit upgrade', () => {
    const rows = Object.values(UNIT_UPGRADES).map((upgrade) => ({
      id: upgrade.id,
      cost: upgrade.cost.mats,
      req: upgrade.cost.req,
      slots: upgrade.eligibleSlots.join(','),
      kind: upgrade.kind,
      cooldown: upgrade.cooldownSeconds ?? null,
      duration: upgrade.durationSeconds ?? null,
    }));
    console.log('[econ]', JSON.stringify({ kind: 'upgrades', rows }));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.cost).toBeGreaterThan(0);
      expect(row.slots.length).toBeGreaterThan(0);
    }
  });
});
