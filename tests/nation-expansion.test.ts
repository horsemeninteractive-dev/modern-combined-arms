import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { ALLIANCES, FACTIONS, NATIONS, NATION_LIST, PLAYABLE_NATION_IDS, identityDef } from '../src/data/factions';
import { productionEntries, resolveRoster, validateRosterRegistry } from '../src/data/roster';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { UNITS, unitFamily } from '../src/data/units';
import {
  RESEARCH,
  exclusiveUnitTech,
  requiredTechnologiesForUnit,
} from '../src/data/research';
import { resolveVariantChain } from '../src/data/variant';
import { createTeamState } from '../src/multiplayer/projection';
import { CommandGate } from '../src/multiplayer/commandGate';
import { AIController, initialAIState } from '../src/sim/ai';
import { completeResearch, harbourWith } from './helpers';
import type { Scenario } from '../src/sim/scenario';

/**
 * Ten-nation expansion.
 *
 * The launch six are pinned by `factions`, `national-specialisations` and
 * `national-roster-complete`. This suite owns the expansion itself: the coalition
 * shape, the exactly-three rule on every nation, the research gate each new
 * exclusive sits behind, and the paths new equipment has to travel — production,
 * multiplayer projection, command validation, save/load and the AI.
 */

const EXPANSION = ['finland', 'sweden', 'iran', 'northKorea'] as const;

const GATE: Readonly<Record<string, { facility: string; tech: string | null }>> = {
  spikeTeam: { facility: 'barracks', tech: 'fires1' },
  gripen: { facility: 'airfield', tech: 'air2' },
  mohajer6: { facility: 'airfield', tech: 'air1' },
  koksan: { facility: 'factory', tech: 'fires2' },
};

/**
 * The two nations that also field a ship of their own. A naval hull is a
 * fourth specialisation rather than a replacement for the land/air exclusive:
 * Sweden keeps the Gripen and the Kockums yard, Iran keeps the Mohajer-6 and
 * the Noor battery.
 */
const NAVAL_HULLS: Readonly<Record<string, { hull: string; tech: string }>> = {
  sweden: { hull: 'visby', tech: 'naval1' },
  iran: { hull: 'ghadir', tech: 'naval2' },
};

/**
 * Canonical slots two nations of one coalition are allowed to share, each with
 * the reason the platforms are not interchangeable. Everything else must be
 * unique: a shared slot is a design decision, not an accident.
 */
const SHARED_SLOTS: Readonly<Record<string, string>> = {
  spg: 'UK Rocket Battery vs Finnish K9: saturation rockets with a wide dead zone against a precision tube.',
};

function arena(playerNation: string, enemyNation = 'lithuania'): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'nation-expansion-test';
  scenario.settings.seed = 8123;
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 1200;
  scenario.settings.fog = true;
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
    { defId: 'factory', owner: 0, x: 14, z: 6 },
    { defId: 'barracks', owner: 0, x: 20, z: 6 },
    { defId: 'airfield', owner: 0, x: 14, z: 16 },
  );
  return scenario;
}

function build(nation: string): Game {
  const game = new Game(arena(nation), { enableAI: false });
  const player = game.player(0)!;
  player.mats = 6000;
  player.req = 1200;
  return game;
}

describe('ten-nation registry', () => {
  it('registers ten playable nations, five per coalition', () => {
    expect(PLAYABLE_NATION_IDS).toHaveLength(10);
    expect(new Set(PLAYABLE_NATION_IDS).size).toBe(10);
    expect(NATION_LIST).toHaveLength(10);
    const defender = NATION_LIST.filter((nation) => nation.allianceId === 'defender');
    const eastern = NATION_LIST.filter((nation) => nation.allianceId === 'eastern');
    expect(defender.map((nation) => nation.id)).toEqual([
      'lithuania',
      'poland',
      'uk',
      'finland',
      'sweden',
    ]);
    expect(eastern.map((nation) => nation.id)).toEqual([
      'russia',
      'belarus',
      'hungary',
      'iran',
      'northKorea',
    ]);
    for (const nation of NATION_LIST) {
      expect(nation.name.length).toBeGreaterThan(0);
      expect(nation.shortName.length).toBeGreaterThan(0);
      expect(nation.doctrine.length).toBeGreaterThan(0);
      expect(identityDef(nation.id).playable).toBe(true);
    }
  });

  it('keeps both legacy presets valid and free of national content', () => {
    expect(Object.keys(FACTIONS).sort()).toEqual(['baltic', 'expeditionary']);
    expect(() => validateRosterRegistry()).not.toThrow();
    for (const preset of Object.values(FACTIONS)) {
      expect(resolveRoster(preset.id)).toEqual(ALLIANCES[preset.allianceId].baseline);
    }
  });

  it('gives every nation one replacement, one exclusive, one structure variant and its hull', () => {
    const coverage = new Map<string, string[]>();
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      const baseline = new Set(ALLIANCES[nation.allianceId].baseline.units);
      const exclusives = roster.units.filter((id) => UNITS[id].national && !UNITS[id].variantOf);
      const variants = roster.buildings.filter(
        (id) => BUILDINGS[id].national && BUILDINGS[id].variantOf !== undefined,
      );
      const replacements = roster.units.filter((id) => !baseline.has(id) && !exclusives.includes(id));
      const hull = NAVAL_HULLS[nation.id]?.hull;
      expect(replacements, `${nation.id} replacements`).toHaveLength(1);
      expect(exclusives, `${nation.id} exclusives`).toHaveLength(hull ? 2 : 1);
      if (hull) {
        // The second one is a ship, not a second land or air capability.
        expect(exclusives, `${nation.id} hull`).toContain(hull);
        expect(UNITS[hull].domain, `${hull} domain`).toBe('naval');
        expect(UNITS[hull].producedBy, `${hull} yard`).toEqual(['shipyard']);
      }
      expect(variants, `${nation.id} structure variants`).toHaveLength(1);
      // One national id belongs to exactly one nation, so a shared id cannot
      // quietly give two nations the same equipment.
      for (const id of [...replacements, ...exclusives, ...variants]) {
        expect(coverage.has(id), `${id} is claimed twice`).toBe(false);
        coverage.set(id, [nation.id]);
      }
    }
    expect(coverage.size).toBe(NATION_LIST.length * 3 + Object.keys(NAVAL_HULLS).length);
  });

  it('resolves every national variant chain to a canonical root with no duplicates', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      for (const id of roster.units) {
        expect(resolveVariantChain(UNITS, id).error, `${id} chain`).toBeUndefined();
      }
      for (const id of roster.buildings) {
        expect(resolveVariantChain(BUILDINGS, id).error, `${id} chain`).toBeUndefined();
      }
      const unitSlots = roster.units.map((id) => unitFamily(id));
      expect(new Set(unitSlots).size, `${nation.id} unit slots`).toBe(unitSlots.length);
      const buildingSlots = roster.buildings.map((id) => buildingFamily(id));
      expect(new Set(buildingSlots).size, `${nation.id} building slots`).toBe(
        buildingSlots.length,
      );
    }
  });

  it('does not let two nations of one coalition replace the same canonical slot', () => {
    for (const alliance of Object.values(ALLIANCES)) {
      const slots = new Map<string, { nation: string; id: string }>();
      for (const nation of NATION_LIST.filter((entry) => entry.allianceId === alliance.id)) {
        for (const replacement of Object.values(nation.roster?.replaceUnits ?? {})) {
          const slot = unitFamily(replacement);
          const prior = slots.get(slot);
          if (prior) {
            // A shared slot has to be declared and has to field a different
            // platform; inheriting the other nation's unit is never allowed.
            expect(SHARED_SLOTS[slot], `${alliance.id} ${slot} replaced twice`).toBeDefined();
            expect(prior.id, `${slot} shares a platform`).not.toBe(replacement);
          }
          slots.set(slot, { nation: nation.id, id: replacement });
        }
        for (const variant of Object.values(nation.roster?.replaceBuildings ?? {})) {
          const slot = buildingFamily(variant);
          expect(slots.has(`building:${slot}`), `${alliance.id} ${slot} built twice`).toBe(false);
          slots.set(`building:${slot}`, { nation: nation.id, id: variant });
        }
      }
    }
  });

  it('keeps every new nation’s doctrine, colour and name distinct', () => {
    const names = new Set(NATION_LIST.map((nation) => nation.name));
    const colours = new Set(NATION_LIST.map((nation) => nation.color ?? ''));
    expect(names.size).toBe(10);
    expect(colours.size).toBe(10);
    for (const id of EXPANSION) {
      const nation = NATIONS[id];
      expect(nation.roster?.replaceUnits).toBeDefined();
      expect(nation.roster?.addUnits).toHaveLength(NAVAL_HULLS[id] ? 2 : 1);
      expect(nation.roster?.replaceBuildings).toBeDefined();
    }
  });
});

describe('expansion research and production', () => {
  it('gates each expansion exclusive behind its branch tier', () => {
    for (const [exclusive, gate] of Object.entries(GATE)) {
      expect(exclusiveUnitTech(exclusive)).toBe(gate.tech);
      const nation = NATION_LIST.find((entry) =>
        (entry.roster?.addUnits ?? []).includes(exclusive),
      )!;
      const game = build(nation.id);
      // The fixture pre-places an airfield so air exclusives have somewhere to
      // be built, and an authored structure implicitly grants its own slot's
      // technology. Clearing the tree models a nation that has studied nothing.
      game.player(0)!.research.completed = [];
      const facility = game
        .entitiesOf(0, 'building')
        .find((e) => e.defId === gate.facility)!;
      // Locked first, with a reason that names the technology, not a generic
      // refusal.
      const locked = game.productionStatus(0, facility.id, exclusive);
      expect(locked.ok, `${exclusive} before research`).toBe(false);
      expect(locked.reason).toMatch(/research|locked|requires/i);

      const tech = RESEARCH.techs.find((entry) => entry.id === gate.tech);
      expect(tech, `${gate.tech} exists`).toBeDefined();
      completeResearch(game, 0);
      expect(game.productionStatus(0, facility.id, exclusive).ok, exclusive).toBe(true);
    }
  });

  it('gates each national naval hull behind its own navy tier', () => {
    for (const [nation, spec] of Object.entries(NAVAL_HULLS)) {
      expect(exclusiveUnitTech(spec.hull)).toBe(spec.tech);
      expect(NATIONS[nation].roster?.addUnits ?? []).toContain(spec.hull);
      const game = new Game(harbourWith(nation), { enableAI: false });
      const player = game.player(0)!;
      player.research.completed = [];
      // `productionStatus` folds affordability into `ok`; a hull is a fleet
      // purchase, so the fixture has to hold the price before the gate is read.
      player.mats = 4000;
      player.req = 1000;
      const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
      const locked = game.productionStatus(0, yard.id, spec.hull);
      expect(locked.ok, `${spec.hull} before research`).toBe(false);
      expect(locked.reason).toMatch(/research|locked|requires/i);

      const tech = RESEARCH.techs.find((entry) => entry.id === spec.tech)!;
      game.player(0)!.research.completed = [tech.id, ...tech.requires];
      expect(game.productionStatus(0, yard.id, spec.hull).ok, spec.hull).toBe(true);
    }
  });

  it('never lets another nation build a national hull', () => {
    for (const [nation, spec] of Object.entries(NAVAL_HULLS)) {
      for (const other of NATION_LIST) {
        if (other.id === nation) continue;
        expect(resolveRoster(other.id).units, `${other.id} fields ${spec.hull}`).not.toContain(
          spec.hull,
        );
      }
      const outsider = new Game(harbourWith('lithuania'), { enableAI: false });
      completeResearch(outsider, 0);
      expect(outsider.canProduce(0, spec.hull), `${spec.hull} leaked`).toBe(false);
    }
  });

  it('keeps each replacement behind its canonical slot’s unlock', () => {
    for (const nation of NATION_LIST.filter((entry) => EXPANSION.includes(entry.id as never))) {
      const replacement = Object.values(nation.roster!.replaceUnits ?? {})[0];
      const required = requiredTechnologiesForUnit(replacement);
      const game = build(nation.id);
      game.player(0)!.research.completed = [];
      const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
      if (required.length === 0) {
        // A tier-0 slot stays available from the first tick: the replacement
        // rides on the shared slot's baseline availability, not on a new gate.
        expect(game.productionStatus(0, factory.id, replacement).ok, replacement).toBe(true);
        continue;
      }
      expect(game.productionStatus(0, factory.id, replacement).ok, replacement).toBe(false);
      // Completing the slot's own technology, and its prerequisites, opens it.
      const ids = new Set<string>();
      for (const tech of required) {
        ids.add(tech.id);
        for (const dependency of tech.requires) ids.add(dependency);
      }
      game.player(0)!.research.completed = [...ids];
      expect(game.productionStatus(0, factory.id, replacement).ok, replacement).toBe(true);
    }
  });

  it('lets each new nation field its own replacement and exclusive, and nobody else', () => {
    for (const nation of NATION_LIST.filter((entry) => EXPANSION.includes(entry.id as never))) {
      const exclusive = nation.roster!.addUnits![0];
      const replacement = Object.values(nation.roster!.replaceUnits ?? {})[0];
      const game = build(nation.id);
      completeResearch(game, 0);
      expect(game.canProduce(0, exclusive), `${nation.id} ${exclusive}`).toBe(true);
      expect(game.canProduce(0, replacement), `${nation.id} ${replacement}`).toBe(true);

      const outsider = build('lithuania');
      completeResearch(outsider, 0);
      expect(outsider.canProduce(0, exclusive), `${exclusive} leaked`).toBe(false);
      expect(outsider.canProduce(0, replacement), `${replacement} leaked`).toBe(false);
    }
  });

  it('produces each national unit from a facility the nation can actually build', () => {
    // Facility families, not def ids: a Finnish Garrison Barracks stands in for
    // the shared barracks and a Swedish Kockums yard for the shipyard, so the
    // national structure has to resolve the same production list.
    for (const nation of NATION_LIST.filter((entry) => EXPANSION.includes(entry.id as never))) {
      const roster = resolveRoster(nation.id);
      const national = [
        ...Object.values(nation.roster!.replaceUnits ?? {}),
        ...(nation.roster!.addUnits ?? []),
      ];
      for (const id of national) {
        const reachable = roster.buildings.filter((building) =>
          productionEntries(roster, building).includes(id),
        );
        expect(reachable.length, `${nation.id} cannot build ${id} anywhere`).toBeGreaterThan(0);
      }
    }
  });

  it('builds each new structure variant and refuses it to another nation', () => {
    for (const nation of NATION_LIST.filter((entry) => EXPANSION.includes(entry.id as never))) {
      const variant = Object.values(nation.roster!.replaceBuildings ?? {})[0];
      const slot = BUILDINGS[variant].variantOf!;
      const game = build(nation.id);
      completeResearch(game, 0);
      expect(game.canBuild(0, variant), `${nation.id} ${variant}`).toBe(true);
      expect(game.canBuild(0, slot), `${nation.id} ${slot}`).toBe(false);

      const outsider = build('poland');
      completeResearch(outsider, 0);
      expect(outsider.canBuild(0, variant), `${variant} leaked`).toBe(false);
    }
  });
});

describe('expansion command validation', () => {
  it('refuses a foreign seat producing another nation’s exclusive', () => {
    const game = build('iran');
    completeResearch(game, 0);
    const airfield = game.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
    const envelope = (command: unknown) => ({ v: 1, command });
    // Seat 1 is Poland in this match; it cannot buy the Iranian drone.
    const foreign = gate.submit(
      1,
      envelope({ type: 'produce', buildingId: airfield.id, defId: 'mohajer6' }),
      1000,
    );
    expect(foreign.ok).toBe(false);
    const own = gate.submit(
      0,
      envelope({ type: 'produce', buildingId: airfield.id, defId: 'mohajer6' }),
      1200,
    );
    expect(own.ok).toBe(true);
    game.tick();
    expect(airfield.queue.map((item) => item.defId)).toEqual(['mohajer6']);
  });
});

describe('expansion multiplayer projection', () => {
  it('sends each new nation its own equipment and keeps it from the opponent', () => {
    for (const nation of NATION_LIST.filter((entry) => EXPANSION.includes(entry.id as never))) {
      const exclusive = nation.roster!.addUnits![0];
      const scenario = arena(nation.id);
      scenario.units.push({ defId: exclusive, owner: 0, x: 10, z: 10 });
      const game = new Game(scenario, { enableAI: false });
      const unit = game.entitiesOf(0, 'unit').find((e) => e.defId === exclusive)!;

      const own = createTeamState(game, 0, 0);
      expect(own.players[0].factionId).toBe(nation.id);
      expect(own.entities.some((e) => e.id === unit.id && e.defId === exclusive)).toBe(true);

      const enemy = createTeamState(game, 1, 0);
      expect(enemy.players[0].factionId).toBe('lithuania');
      // The unit sits at the player's base, unseen by the opponent.
      expect(enemy.entities.some((e) => e.id === unit.id)).toBe(false);
    }
  });

  it('keeps each new squad’s roster resolution identical on both sides of a save', () => {
    for (const nation of EXPANSION) {
      const scenario = arena(nation);
      scenario.units.push({
        defId: NATIONS[nation].roster!.addUnits![0],
        owner: 0,
        x: 10,
        z: 10,
      });
      const game = new Game(scenario, { enableAI: false });
      game.advance(20);
      const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
      expect(loaded.player(0)?.factionId).toBe(nation);
      expect(loaded.rosterFor(0)).toEqual(resolveRoster(nation));
      expect(loaded.stateHash()).toBe(game.stateHash());
    }
  });

  it('parses a scenario that names every new nation', () => {
    for (const nation of EXPANSION) {
      const scenario = arena(nation, 'russia');
      const json = JSON.parse(JSON.stringify(scenario)) as Scenario;
      const game = new Game(json, { enableAI: false });
      expect(game.player(0)?.factionId).toBe(nation);
      expect(game.state.scenario.players[0].factionId).toBe(nation);
    }
  });
});

describe('expansion AI', () => {
  it('plays each new nation with its own roster and never buys outside it', () => {
    for (const nation of EXPANSION) {
      const scenario = arena('lithuania', nation);
      scenario.players[1].isAI = true;
      scenario.players[1].technologies = RESEARCH.techs.map((tech) => tech.id);
      scenario.structures.push(
        { defId: 'factory', owner: 1, x: 36, z: 20 },
        { defId: 'barracks', owner: 1, x: 36, z: 26 },
        { defId: 'refinery', owner: 1, x: 32, z: 24 },
        { defId: 'airfield', owner: 1, x: 36, z: 36 },
      );
      scenario.units.push(
        { defId: 'engineer', owner: 1, x: 39, z: 22 },
        { defId: 'harvester', owner: 1, x: 34, z: 24 },
      );
      const game = new Game(scenario, { enableAI: false });
      const roster = game.rosterFor(1);
      const ai = new AIController();
      const state = initialAIState(11, 'veteran');
      const queued = new Set<string>();
      for (let i = 0; i < 20 * 60 && game.state.victory === 'playing'; i++) {
        game.tick();
        ai.update(game, 1, state);
        for (const building of game.entitiesOf(1, 'building')) {
          for (const item of building.queue) queued.add(item.defId);
        }
      }
      for (const id of queued) {
        expect(roster.units, `${nation} queued foreign unit ${id}`).toContain(id);
      }
    }
  });
});
