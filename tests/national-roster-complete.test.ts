import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { BUILDINGS, buildingFamily, buildingRequirements } from '../src/data/buildings';
import { UNITS, unitFamily } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { ALLIANCES, FACTIONS, NATIONS, NATION_LIST } from '../src/data/factions';
import { productionEntries, resolveRoster } from '../src/data/roster';
import { resolveVariantChain } from '../src/data/variant';
import { AIController, initialAIState } from '../src/sim/ai';
import { completeResearch, harbourWith } from './helpers';
import { RESEARCH, exclusiveUnitTech } from '../src/data/research';
import { buildingStyle } from '../src/render/buildingMeshes';
import { unitBannerHeight, unitStyle } from '../src/render/unitMeshes';
import { BUILDING_FLAG_ANCHORS } from '../src/render/flags';
import { unitVoiceSetId } from '../src/ui/unitVoice';
import type { Scenario } from '../src/sim/scenario';

/**
 * Complete national specialisations.
 *
 * Every nation carries three differences from its alliance baseline: one
 * replacement in an existing slot, one exclusive unit that declares no slot,
 * and one structure variant. Sweden and Iran add a fourth: a national naval
 * hull, so their fleet identity is a ship rather than only a yard variant.
 * These tests pin that shape, the isolation that keeps one nation's equipment
 * out of another's roster, and the production, AI and presentation paths the
 * extra content has to travel.
 */

interface Specialisation {
  readonly nation: string;
  /** Canonical slot the replacement occupies. */
  readonly slot: string;
  readonly replacement: string;
  readonly exclusive: string;
  readonly buildingSlot: string;
  readonly building: string;
  readonly exclusiveFacility: string;
  /** National naval hull, fielded by Sweden and Iran only. */
  readonly navalHull?: string;
  /** Branch tier that unlocks the hull, from `EXCLUSIVE_UNIT_TECH`. */
  readonly navalHullTech?: string;
}

const SPECIALISATIONS: readonly Specialisation[] = [
  {
    nation: 'lithuania',
    slot: 'recon',
    replacement: 'pathfinder',
    exclusive: 'kestrelTeam',
    buildingSlot: 'radar',
    building: 'forwardPost',
    exclusiveFacility: 'barracks',
  },
  {
    nation: 'poland',
    slot: 'tank',
    replacement: 'spearhead',
    exclusive: 'wilk',
    buildingSlot: 'factory',
    building: 'armourWorks',
    exclusiveFacility: 'factory',
  },
  {
    nation: 'uk',
    slot: 'spg',
    replacement: 'mlrs',
    exclusive: 'stormShadow',
    buildingSlot: 'airfield',
    building: 'expeditionaryAirfield',
    exclusiveFacility: 'factory',
  },
  {
    nation: 'russia',
    slot: 'spg',
    replacement: 'heavyHowitzer',
    exclusive: 'tosp',
    buildingSlot: 'samBattery',
    building: 'longRangeSam',
    exclusiveFacility: 'factory',
  },
  {
    nation: 'belarus',
    slot: 'uav',
    replacement: 'deepReconUAV',
    exclusive: 'sprut',
    buildingSlot: 'researchCentre',
    building: 'signalsBureau',
    exclusiveFacility: 'factory',
  },
  {
    nation: 'hungary',
    slot: 'atgm',
    replacement: 'hedgehogTeam',
    exclusive: 'taszar',
    buildingSlot: 'mgNest',
    building: 'bunker',
    exclusiveFacility: 'barracks',
  },
  {
    nation: 'finland',
    slot: 'spg',
    replacement: 'k9Thunder',
    exclusive: 'spikeTeam',
    buildingSlot: 'barracks',
    building: 'garrisonBarracks',
    exclusiveFacility: 'barracks',
  },
  {
    nation: 'sweden',
    slot: 'ifv',
    replacement: 'cv90',
    exclusive: 'gripen',
    buildingSlot: 'shipyard',
    building: 'kockumsYard',
    exclusiveFacility: 'airfield',
    navalHull: 'visby',
    navalHullTech: 'naval1',
  },
  {
    nation: 'iran',
    slot: 'aa',
    replacement: 'khordadSam',
    exclusive: 'mohajer6',
    buildingSlot: 'coastalBattery',
    building: 'noorBattery',
    exclusiveFacility: 'airfield',
    navalHull: 'ghadir',
    navalHullTech: 'naval2',
  },
  {
    nation: 'northKorea',
    slot: 'td',
    replacement: 'bulsae4',
    exclusive: 'koksan',
    buildingSlot: 'atTurret',
    building: 'entrenchedAtGun',
    exclusiveFacility: 'factory',
  },
] as const;

/** The unit the alliance baseline fields in the given canonical slot. */
function alliancePlatform(nation: string, slot: string): string {
  const alliance = ALLIANCES[NATIONS[nation].allianceId];
  const platform = alliance.baseline.units.find((id) => unitFamily(id) === slot);
  if (!platform) throw new Error(`alliance ${alliance.id} has no platform for ${slot}`);
  return platform;
}

/** Every national id: replacements, exclusives and structure variants. */
const NATIONAL_IDS = SPECIALISATIONS.flatMap((entry) => [
  entry.replacement,
  entry.exclusive,
  entry.building,
  ...(entry.navalHull ? [entry.navalHull] : []),
]);

function arena(playerNation: string, enemyNation = 'lithuania'): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'national-roster-complete-test';
  scenario.settings.seed = 5150;
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 1000;
  scenario.players[0].factionId = playerNation;
  scenario.players[0].startX = 6;
  scenario.players[0].startZ = 6;
  scenario.players[1].factionId = enemyNation;
  scenario.players[1].startX = size - 7;
  scenario.players[1].startZ = size - 7;
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'commandPost', owner: 1, x: size - 9, z: size - 9 },
  );
  return scenario;
}

describe('national specialisation integrity', () => {
  it('declares one replacement, one exclusive, one structure variant and the hulls', () => {
    expect(NATION_LIST).toHaveLength(SPECIALISATIONS.length);
    for (const entry of SPECIALISATIONS) {
      const roster = resolveRoster(entry.nation);
      const exclusives = roster.units.filter((id) => UNITS[id].national && !UNITS[id].variantOf);
      const variants = roster.buildings.filter(
        (id) => BUILDINGS[id].national && BUILDINGS[id].variantOf !== undefined,
      );
      expect(exclusives, `${entry.nation} exclusives`).toEqual(
        entry.navalHull ? [entry.exclusive, entry.navalHull] : [entry.exclusive],
      );
      expect(variants, `${entry.nation} structure variants`).toEqual([entry.building]);
      // The replacement is the only roster unit that is neither its alliance
      // baseline nor the nation's exclusive. Eastern platforms are non-baseline
      // ids in `UNIT_LIST` terms, so compare against the alliance, not the file.
      const baseline = new Set(ALLIANCES[NATIONS[entry.nation].allianceId].baseline.units);
      const replacements = roster.units.filter(
        (id) => !baseline.has(id) && !exclusives.includes(id),
      );
      expect(replacements, `${entry.nation} replacements`).toEqual([entry.replacement]);
    }
  });

  it('keeps declarations and resolved content in agreement', () => {
    for (const entry of SPECIALISATIONS) {
      const nation = NATIONS[entry.nation];
      expect(nation.roster?.addUnits).toEqual(
        entry.navalHull ? [entry.exclusive, entry.navalHull] : [entry.exclusive],
      );
      expect(Object.values(nation.roster?.replaceUnits ?? {})).toContain(entry.replacement);
      expect(Object.values(nation.roster?.replaceBuildings ?? {})).toEqual([entry.building]);
      expect(nation.roster?.removeUnits).toBeUndefined();
      expect(nation.roster?.addBuildings).toBeUndefined();
    }
  });

  it('resolves every replacement through its alliance platform to the canonical slot', () => {
    for (const entry of SPECIALISATIONS) {
      const platform = alliancePlatform(entry.nation, entry.slot);
      const chain = resolveVariantChain(UNITS, entry.replacement);
      expect(chain.error, `${entry.replacement} chain`).toBeUndefined();
      expect(chain.root).toBe(entry.slot);
      // The replacement sits on the platform its nation actually fields: the
      // canonical id for a Defender nation, the coalition platform for an
      // Eastern one. That is what keeps the chain slot → platform → national.
      expect(UNITS[entry.replacement].variantOf).toBe(platform);
      expect(chain.path.slice(0, 2)).toEqual([entry.replacement, platform]);
      expect(unitFamily(entry.replacement)).toBe(entry.slot);
    }
  });

  it('keeps every structure variant inside its parent family and requirements', () => {
    for (const entry of SPECIALISATIONS) {
      expect(BUILDINGS[entry.building].variantOf).toBe(entry.buildingSlot);
      expect(buildingFamily(entry.building)).toBe(entry.buildingSlot);
      expect(buildingRequirements(entry.building)).toEqual(
        buildingRequirements(entry.buildingSlot),
      );
      expect(buildingStyle(entry.building), `${entry.building} mesh`).toBeDefined();
      expect(BUILDING_FLAG_ANCHORS[entry.building], `${entry.building} flag`).toBeDefined();
      expect(BUILDINGS[entry.building].national).toBe(true);
    }
  });

  it('keeps exclusives out of the canonical slot namespace', () => {
    for (const entry of SPECIALISATIONS) {
      const exclusive = UNITS[entry.exclusive];
      // An exclusive must not declare variantOf, or the roster would hold two
      // definitions in one slot and the production list would have to guess.
      expect(exclusive.variantOf).toBeUndefined();
      expect(unitFamily(entry.exclusive)).toBe(entry.exclusive);
      expect(exclusive.national).toBe(true);
      expect(exclusive.producedBy).toContain(entry.exclusiveFacility);
    }
  });
});

describe('national isolation', () => {
  it('keeps every national id out of the other five rosters', () => {
    for (const entry of SPECIALISATIONS) {
      for (const other of NATION_LIST) {
        if (other.id === entry.nation) continue;
        const roster = resolveRoster(other.id);
        for (const id of [entry.replacement, entry.exclusive, entry.navalHull ?? '']) {
          if (!id) continue;
          expect(roster.units, `${other.id} must not field ${id}`).not.toContain(id);
        }
        expect(roster.buildings, `${other.id} must not build ${entry.building}`).not.toContain(
          entry.building,
        );
      }
    }
  });

  it('keeps both alliance baselines and every legacy preset free of national content', () => {
    for (const id of NATIONAL_IDS) {
      for (const alliance of Object.values(ALLIANCES)) {
        expect(alliance.baseline.units).not.toContain(id);
        expect(alliance.baseline.buildings).not.toContain(id);
      }
      for (const preset of Object.values(FACTIONS)) {
        const roster = resolveRoster(preset.id);
        expect(roster.units).not.toContain(id);
        expect(roster.buildings).not.toContain(id);
      }
    }
  });

  it('holds at most one definition per canonical slot on every roster', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      const slots = roster.units.map((id) => unitFamily(id));
      expect(new Set(slots).size, `${nation.id} unit slots`).toBe(slots.length);
      const buildingSlots = roster.buildings.map((id) => buildingFamily(id));
      expect(new Set(buildingSlots).size, `${nation.id} building slots`).toBe(
        buildingSlots.length,
      );
    }
  });
});

describe('national production', () => {
  it('lists every national unit in a facility that can actually build it', () => {
    for (const entry of SPECIALISATIONS) {
      const roster = resolveRoster(entry.nation);
      const exclusiveEntries = productionEntries(roster, entry.exclusiveFacility);
      expect(exclusiveEntries, `${entry.nation} exclusive`).toContain(entry.exclusive);
      // A replacement keeps the facility of the slot it fills, so ask that
      // facility. The list names the replacement and never the excluded slot.
      const replacementFacility = UNITS[entry.replacement].producedBy[0];
      const facilityId = roster.buildings.find(
        (id) => buildingFamily(id) === buildingFamily(replacementFacility),
      )!;
      const replacementEntries = productionEntries(roster, facilityId);
      expect(replacementEntries, `${entry.nation} replacement`).toContain(entry.replacement);
      expect(replacementEntries).not.toContain(entry.slot);
    }
  });

  it('leaves no roster unit without a production route', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      const producible = new Set<string>();
      for (const building of roster.buildings) {
        for (const id of productionEntries(roster, building)) producible.add(id);
      }
      for (const id of roster.units) {
        expect(producible.has(id), `${nation.id}: ${id} has no facility`).toBe(true);
      }
    }
  });

  it('accepts the national content and refuses the other nations through the command gate', () => {
    for (const entry of SPECIALISATIONS) {
      const scenario = arena(entry.nation);
      scenario.structures.push(
        { defId: 'factory', owner: 0, x: 14, z: 6 },
        { defId: 'barracks', owner: 0, x: 14, z: 14 },
        // The Swedish and Iranian exclusives are airframes, so the gate arena
        // has to offer every facility a national exclusive can name.
        { defId: 'airfield', owner: 0, x: 26, z: 14 },
      );
      const game = new Game(scenario, { enableAI: false });
      expect(game.canProduce(0, entry.exclusive), `${entry.nation} exclusive`).toBe(true);
      expect(game.canProduce(0, entry.replacement), `${entry.nation} replacement`).toBe(true);
      expect(game.canBuild(0, entry.building), `${entry.nation} structure`).toBe(true);
      expect(game.canBuild(0, entry.buildingSlot), `${entry.nation} baseline structure`).toBe(
        false,
      );

      const outsider = new Game(arena('poland'), { enableAI: false });
      if (entry.nation !== 'poland') {
        expect(outsider.canProduce(0, entry.exclusive), `${entry.nation} exclusive leak`).toBe(
          false,
        );
        expect(outsider.canBuild(0, entry.building), `${entry.nation} structure leak`).toBe(false);
      }
    }
  });

  it('builds a national exclusive and a national structure through the simulation', () => {
    const scenario = arena('hungary');
    scenario.structures.push(
      { defId: 'barracks', owner: 0, x: 14, z: 6 },
      { defId: 'factory', owner: 0, x: 14, z: 14 },
    );
    scenario.units.push({ defId: 'engineer', owner: 0, x: 10, z: 8 });
    const game = new Game(scenario, { enableAI: false });
    completeResearch(game, 0);

    const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    game.enqueueCommand({
      type: 'produce',
      team: 0,
      buildingId: barracks.id,
      defId: 'taszar',
    });
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    game.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      builderId: engineer.id,
      defId: 'bunker',
      tileX: 18,
      tileZ: 6,
    });
    game.advance(20 * 30);
    expect(game.entitiesOf(0, 'unit').some((e) => e.defId === 'taszar')).toBe(true);
    const bunker = game.entitiesOf(0, 'building').find((e) => e.defId === 'bunker');
    expect(bunker).toBeDefined();
    expect(bunker!.construction).toBeFalsy();
  });

  it('restores national content after a save round trip', () => {
    const scenario = arena('poland');
    scenario.units.push({ defId: 'wilk', owner: 0, x: 12, z: 12 });
    const game = new Game(scenario, { enableAI: false });
    game.advance(20);
    const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(loaded.player(0)?.factionId).toBe('poland');
    expect(loaded.rosterFor(0)).toEqual(resolveRoster('poland'));
    expect(loaded.entitiesOf(0, 'unit').some((e) => e.defId === 'wilk')).toBe(true);
    expect(loaded.stateHash()).toBe(game.stateHash());
  });
});

describe('national content for the AI', () => {
  function aiArena(nation: string): Game {
    const scenario = arena('lithuania', nation);
    scenario.players[1].isAI = true;
    scenario.players[1].startX = 40;
    scenario.players[1].startZ = 24;
    // National content sits behind the branch tiers. This suite measures the
    // roster the AI buys, so the tiers are granted the way an authored scenario
    // grants them instead of being researched first.
    scenario.players[1].technologies = [
      'manoeuvre1',
      'manoeuvre2',
      'fires1',
      'fires2',
      'air1',
      'air2',
    ];
    scenario.structures.push(
      { defId: 'factory', owner: 1, x: 36, z: 20 },
      { defId: 'barracks', owner: 1, x: 36, z: 26 },
      { defId: 'refinery', owner: 1, x: 32, z: 24 },
      { defId: 'airfield', owner: 1, x: 40, z: 32 },
    );
    scenario.units.push(
      { defId: 'engineer', owner: 1, x: 39, z: 22 },
      { defId: 'harvester', owner: 1, x: 34, z: 24 },
    );
    return new Game(scenario, { enableAI: false });
  }

  function runAI(nation: string, seconds: number): Set<string> {
    const game = aiArena(nation);
    const ai = new AIController();
    const state = initialAIState(7, 'elite');
    const seen = new Set<string>();
    for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
      game.tick();
      ai.update(game, 1, state);
      for (const building of game.entitiesOf(1, 'building')) {
        for (const item of building.queue) seen.add(item.defId);
      }
      for (const e of game.entitiesOf(1, 'unit')) seen.add(e.defId);
    }
    return seen;
  }

  it('buys the nation its own exclusive and never another nation’s', () => {
    for (const entry of SPECIALISATIONS) {
      const seen = runAI(entry.nation, 90);
      expect(seen.has(entry.exclusive), `${entry.nation} ${entry.exclusive}`).toBe(true);
      for (const other of SPECIALISATIONS) {
        if (other.nation === entry.nation) continue;
        expect(seen.has(other.exclusive), `${entry.nation} bought ${other.exclusive}`).toBe(false);
      }
    }
  });
});

describe('national trade-offs and counterplay', () => {
  it('keeps the Kestrel blind to everything on the ground', () => {
    for (const weaponId of UNITS.kestrelTeam.weapons) {
      const weapon = WEAPONS[weaponId];
      expect(weapon.targets).toEqual(['air']);
      for (const cls of ['infantry', 'light', 'heavy', 'support', 'structure', 'naval'] as const) {
        expect(weapon.multipliers[cls], `${weaponId} ${cls}`).toBe(0);
      }
      expect(weapon.antiAir).toBe(true);
    }
    // Cheap enough to be the air answer a scout screen can afford, and the
    // only infantry platform in the game that can do the job.
    expect(UNITS.kestrelTeam.cost.mats).toBeLessThan(UNITS.aa.cost.mats);
    expect(UNITS.kestrelTeam.canGarrison).toBe(true);
  });

  it('keeps the Taszar an infantry weapon with an infantry weapon’s reach', () => {
    const mortar = WEAPONS[UNITS.taszar.weapons[0]];
    expect(mortar.indirect).toBe(true);
    expect(mortar.minRange).toBeGreaterThan(0);
    expect(WEAPONS.howitzer.range).toBeGreaterThan(mortar.range);
    // It cannot answer armour at all, which is the reason it is not a vehicle.
    expect(mortar.multipliers.heavy).toBeLessThan(0.2);
    expect(UNITS.taszar.weapons).toEqual(['lightMortar']);
  });

  it('keeps the Storm Shadow blind and dependent on another unit’s optics', () => {
    const missile = WEAPONS[UNITS.stormShadow.weapons[0]];
    expect(missile.indirect).toBe(true);
    expect(missile.minRange).toBeGreaterThanOrEqual(14);
    expect(UNITS.stormShadow.vision).toBeLessThan(missile.range);
    expect(UNITS.stormShadow.cost.mats).toBeGreaterThan(UNITS.spg.cost.mats);
    expect(UNITS.stormShadow.hp).toBeLessThan(UNITS.spg.hp);
  });

  it('keeps the TOSP shorter-ranged than every shared gun', () => {
    const launcher = WEAPONS[UNITS.tosp.weapons[0]];
    expect(launcher.range).toBeLessThan(WEAPONS.howitzer.range);
    expect(launcher.range).toBeLessThan(WEAPONS.howitzer.minRange! + 6);
    expect(launcher.splash!).toBeGreaterThan(WEAPONS.howitzer.splash!);
    expect(launcher.cooldown).toBeGreaterThan(WEAPONS.howitzer.cooldown);
  });

  it('keeps the Sprut blind, unarmoured and alive only by speed', () => {
    expect(UNITS.sprut.weapons).toEqual([]);
    expect(UNITS.sprut.speed).toBeGreaterThan(UNITS.reconEC.speed);
    expect(UNITS.sprut.hp).toBeLessThan(UNITS.reconEC.hp);
    expect(UNITS.sprut.cost.mats).toBeLessThan(UNITS.reconEC.cost.mats);
  });

  it('keeps the Wilk short of a tank while it can still fight one', () => {
    expect(UNITS.wilk.weapons).toContain('atgm');
    expect(UNITS.wilk.cost.mats).toBeLessThan(UNITS.tank.cost.mats);
    expect(UNITS.wilk.hp).toBeLessThan(UNITS.tank.hp);
    expect(UNITS.wilk.speed).toBeLessThan(UNITS.tank.speed);
  });

  it('keeps the Hedgehog a shorter, faster-firing defensive missile', () => {
    expect(WEAPONS.hedgehogAtgm.range).toBeLessThan(WEAPONS.atgm.range);
    expect(WEAPONS.hedgehogAtgm.cooldown).toBeLessThan(WEAPONS.atgm.cooldown);
    expect(UNITS.hedgehogTeam.hp).toBeGreaterThan(UNITS.atgmEC.hp);
    expect(UNITS.hedgehogTeam.cost.mats).toBeLessThan(UNITS.atgmEC.cost.mats);
  });

  it('gives every structure variant a real trade rather than a free upgrade', () => {
    // Cheaper and weaker: vision, durability or both.
    expect(BUILDINGS.forwardPost.cost.mats).toBeLessThan(BUILDINGS.radar.cost.mats);
    expect(BUILDINGS.forwardPost.hp).toBeLessThan(BUILDINGS.radar.hp);
    expect(BUILDINGS.forwardPost.vision).toBeLessThan(BUILDINGS.radar.vision);
    expect(BUILDINGS.expeditionaryAirfield.cost.mats).toBeLessThan(BUILDINGS.airfield.cost.mats);
    expect(BUILDINGS.expeditionaryAirfield.buildTime).toBeLessThan(BUILDINGS.airfield.buildTime);
    expect(BUILDINGS.expeditionaryAirfield.hp).toBeLessThan(BUILDINGS.airfield.hp);
    expect(BUILDINGS.signalsBureau.hp).toBeLessThan(BUILDINGS.radar.hp);
    // Tougher but more expensive, with the same production.
    expect(BUILDINGS.armourWorks.hp).toBeGreaterThan(BUILDINGS.factory.hp);
    expect(BUILDINGS.armourWorks.cost.mats).toBeGreaterThan(BUILDINGS.factory.cost.mats);
    expect(BUILDINGS.armourWorks.productionList).toEqual(BUILDINGS.factory.productionList);
    // Longer reach for a higher price and a slower reload.
    expect(WEAPONS.longRangeSamMissile.range).toBeGreaterThan(WEAPONS.samBattery.range);
    expect(WEAPONS.longRangeSamMissile.cooldown).toBeGreaterThan(WEAPONS.samBattery.cooldown);
    expect(BUILDINGS.longRangeSam.cost.mats).toBeGreaterThan(BUILDINGS.samBattery.cost.mats);
    // Cheaper air for a fragile strip, with the same production list.
    expect(BUILDINGS.expeditionaryAirfield.productionList).toEqual(
      BUILDINGS.airfield.productionList,
    );
    // The retained Hungarian bunker still costs more and holds longer.
    expect(BUILDINGS.bunker.hp).toBeGreaterThan(BUILDINGS.mgNest.hp);
    expect(BUILDINGS.bunker.cost.mats).toBeGreaterThan(BUILDINGS.mgNest.cost.mats);
  });
});

describe('national capability in the simulation', () => {
  it('lobs the Taszar mortar over a building but cannot fire inside its dead zone', () => {
    const hit = arena('hungary');
    hit.settings.fog = false;
    hit.structures.push({ defId: 'barracks', owner: 1, x: 18, z: 20 });
    hit.units.push({ defId: 'taszar', owner: 0, x: 13, z: 20 });
    const hitGame = new Game(hit, { enableAI: false });
    const hitTarget = hitGame.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'barracks',
    )!;
    const hitHp = hitTarget.hp;
    hitGame.advance(20 * 20);
    expect(hitTarget.hp).toBeLessThan(hitHp);

    // Inside the three-tile minimum range (the 3x3 barracks centre is 1.5
    // tiles from its anchor), so the crew holds fire.
    const dead = arena('hungary');
    dead.settings.fog = false;
    dead.structures.push({ defId: 'barracks', owner: 1, x: 18, z: 20 });
    dead.units.push({ defId: 'taszar', owner: 0, x: 17, z: 20 });
    const deadGame = new Game(dead, { enableAI: false });
    const deadTarget = deadGame.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'barracks',
    )!;
    const deadHp = deadTarget.hp;
    deadGame.advance(20 * 20);
    expect(deadTarget.hp).toBe(deadHp);
  });
});

describe('national presentation', () => {
  it('gives every exclusive a silhouette and a team marking', () => {
    for (const entry of SPECIALISATIONS) {
      const style = unitStyle(entry.exclusive);
      expect(style, `${entry.exclusive} mesh`).toBeDefined();
      const marked =
        style!.body.teamMask.some((v) => v >= 0.5) ||
        (style!.turret?.teamMask.some((v) => v >= 0.5) ?? false);
      expect(marked, `${entry.exclusive} team marking`).toBe(true);
    }
  });

  it('gives every exclusive its own recorded voice bank', () => {
    for (const entry of SPECIALISATIONS) {
      expect(unitVoiceSetId(entry.exclusive), `${entry.exclusive} voice`).toBe(entry.exclusive);
    }
  });

  it('badges national content and not the alliance platform beside it', () => {
    for (const entry of SPECIALISATIONS) {
      expect(UNITS[entry.exclusive].national).toBe(true);
      expect(UNITS[entry.replacement].national).toBe(true);
      expect(BUILDINGS[entry.building].national).toBe(true);
      // The platform the nation inherits is not national content, even though
      // it is also a variant of a canonical slot.
      expect(UNITS[alliancePlatform(entry.nation, entry.slot)].national).toBeUndefined();
    }
    expect(BUILDINGS.radar.national).toBeUndefined();
  });
});

/**
 * Sweden and Iran field a ship of their own: the fleet identity is the hull,
 * not only the yard that builds it. These cases pin the data shape, the navy
 * gate, the isolation and the fleet trade the hulls were designed around.
 */
describe('national naval hulls', () => {
  const HULLS = SPECIALISATIONS.filter((entry) => entry.navalHull);

  function tierWithPrerequisites(tech: string): string[] {
    const def = RESEARCH.techs.find((entry) => entry.id === tech)!;
    return [def.id, ...def.requires];
  }

  it('registers both hulls as shipyard units of their own nation', () => {
    expect(HULLS.map((entry) => entry.navalHull)).toEqual(['visby', 'ghadir']);
    for (const entry of HULLS) {
      const id = entry.navalHull!;
      const def = UNITS[id];
      expect(def.national).toBe(true);
      expect(def.variantOf).toBeUndefined();
      expect(unitFamily(id)).toBe(id);
      expect(def.domain).toBe('naval');
      expect(def.producedBy).toEqual(['shipyard']);
      expect(exclusiveUnitTech(id)).toBe(entry.navalHullTech);
      expect(productionEntries(resolveRoster(entry.nation), 'shipyard')).toContain(id);
      // The navy hull joins the roster; the yard variant stays where it was.
      expect(resolveRoster(entry.nation).buildings).toContain(entry.building);
    }
  });

  it('keeps each hull locked until its navy tier, then buildable at the yard', () => {
    for (const entry of HULLS) {
      const id = entry.navalHull!;
      const game = new Game(harbourWith(entry.nation), { enableAI: false });
      const player = game.player(0)!;
      player.research.completed = [];
      // `productionStatus` folds affordability into `ok`, so the fixture holds
      // the hull's price before the research gate is read.
      player.mats = 4000;
      player.req = 1000;
      const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
      const locked = game.productionStatus(0, yard.id, id);
      expect(locked.ok, `${id} before research`).toBe(false);
      expect(locked.reason).toMatch(/research|locked|requires/i);

      game.player(0)!.research.completed = tierWithPrerequisites(entry.navalHullTech!);
      expect(game.productionStatus(0, yard.id, id).ok, id).toBe(true);
      expect(game.canProduce(0, id), id).toBe(true);
    }
  });

  it('never offers a hull to another nation', () => {
    for (const entry of HULLS) {
      const id = entry.navalHull!;
      for (const other of NATION_LIST) {
        if (other.id === entry.nation) continue;
        expect(resolveRoster(other.id).units, `${other.id} fields ${id}`).not.toContain(id);
      }
      const outsider = new Game(harbourWith('lithuania'), { enableAI: false });
      completeResearch(outsider, 0);
      expect(outsider.canProduce(0, id), `${id} leaked`).toBe(false);
    }
  });

  it('trades the hull against the fleet it joins rather than replacing it', () => {
    // Visby: fastest and best-sighted surface combatant, thinner hull, two
    // fewer missiles than the shared corvette.
    expect(UNITS.visby.speed).toBeGreaterThan(UNITS.frigate.speed);
    expect(UNITS.visby.speed).toBeGreaterThan(UNITS.corvette.speed);
    expect(UNITS.visby.vision).toBeGreaterThan(UNITS.corvette.vision);
    expect(UNITS.visby.hp).toBeLessThan(UNITS.corvette.hp);
    expect(UNITS.visby.ammo ?? 0).toBeLessThan(UNITS.corvette.ammo ?? 0);
    expect(UNITS.visby.cost.mats).toBeLessThan(UNITS.corvette.cost.mats);
    // Ghadir: a cheap coastal ambusher, not a better ocean-going boat.
    expect(UNITS.ghadir.cost.mats).toBeLessThan(UNITS.submarineEC.cost.mats);
    expect(UNITS.ghadir.ammo ?? 0).toBeLessThan(UNITS.submarineEC.ammo ?? 0);
    expect(UNITS.ghadir.submarine!.batterySeconds).toBeLessThan(
      UNITS.submarineEC.submarine!.batterySeconds,
    );
    expect(UNITS.ghadir.submarine!.revealSeconds).toBeGreaterThan(
      UNITS.submarineEC.submarine!.revealSeconds,
    );
    expect(UNITS.ghadir.vision).toBeLessThan(UNITS.submarineEC.vision);
  });

  it('gives both hulls a silhouette, a voice bank and a banner anchor', () => {
    for (const entry of HULLS) {
      const id = entry.navalHull!;
      expect(unitStyle(id), `${id} mesh`).toBeDefined();
      expect(unitVoiceSetId(id), `${id} voice`).toBe(id);
      // An authored anchor, not the anonymous fallback, so the health bar sits
      // above the hull rather than five units over open water.
      expect(unitBannerHeight(id), `${id} banner`).toBeLessThan(5);
    }
  });
});
