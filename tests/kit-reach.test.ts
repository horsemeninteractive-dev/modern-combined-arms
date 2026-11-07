import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { UNITS, unitFamily } from '../src/data/units';
import { NATION_LIST } from '../src/data/factions';
import { resolveRoster } from '../src/data/roster';
import { RESEARCH } from '../src/data/research';
import { Terrain } from '../src/sim/terrain';
import { harbourWith } from './helpers';

/**
 * National-kit reach.
 *
 * A national replacement or exclusive is only worth its definition if the
 * commander actually orders it. Every other national test stops before this
 * question: the roster suite proves the unit exists and can be produced, the
 * matchup harness scores whole matches, and the AI suites check the arms the
 * production plan names. None of them catches the failure that mattered most —
 * a national variant sitting on a slot the production plan never mentions, so
 * that the kit is correct, available, researched and permanently unreachable.
 *
 * These cases therefore run the real AIController against a staged field and
 * assert that each nation's own units appear on it. Research is granted and the
 * facilities stand at the start, because the question here is production reach,
 * not study order or construction time: a commander that cannot buy the kit even
 * with the branch open and the factory built never buys it at all.
 *
 * Scope is the unit kit. A structure variant is already pinned by the roster
 * suite through `buildingIdFor` and the command gate, and a free-standing
 * building is not something the commander buys on a schedule the way it buys
 * hulls. Naval hulls need water, so they are tested on the harbour fixture.
 *
 * What this case does not answer is how often the kit reaches the field in a
 * live 3 000-material match, where the factory is also buying tanks under
 * contact. That is a procurement-priority question, measured per nation by
 * `tools/nation-matchups.ts` (the `produced` and `structures` fields of each
 * match line), not a reach question. Keeping the two apart stops a starved
 * economy from being reported as an unreachable unit.
 */

const HORIZON_SECONDS = 300;
const HARBOUR_HORIZON_SECONDS = 180;

interface NationKit {
  readonly replacement: string;
  readonly exclusive: string;
}

/**
 * The national unit each nation fields: one replacement in an existing slot and
 * one exclusive that declares no slot. Kept explicit rather than derived so a
 * new national unit cannot join the game without a reach case here.
 */
const KITS: Readonly<Record<string, NationKit>> = {
  lithuania: { replacement: 'pathfinder', exclusive: 'kestrelTeam' },
  poland: { replacement: 'spearhead', exclusive: 'wilk' },
  uk: { replacement: 'mlrs', exclusive: 'stormShadow' },
  finland: { replacement: 'k9Thunder', exclusive: 'spikeTeam' },
  sweden: { replacement: 'cv90', exclusive: 'gripen' },
  russia: { replacement: 'heavyHowitzer', exclusive: 'tosp' },
  belarus: { replacement: 'deepReconUAV', exclusive: 'sprut' },
  hungary: { replacement: 'hedgehogTeam', exclusive: 'taszar' },
  iran: { replacement: 'khordadSam', exclusive: 'mohajer6' },
  northKorea: { replacement: 'bulsae4', exclusive: 'koksan' },
};

/** National hulls, fielded by Sweden and Iran only. */
const HULLS: Readonly<Record<string, string>> = {
  sweden: 'visby',
  iran: 'ghadir',
};

const SIZE = 64;

/**
 * A field army and the facilities that build one, on a map with a real ore
 * field. The army starts as infantry so the commander has to buy its armour:
 * a starter tank in a national slot would count as the kit reaching the field
 * before a single order was given.
 */
function landArena(nation: string): Game {
  const scenario = createEmptyScenario(SIZE, SIZE);
  scenario.meta.id = 'kit-reach';
  scenario.settings.seed = 5150;
  // A bank that covers the kit. The case asks whether the plan orders the
  // national units, not whether the opening economy can afford them — the
  // matchup matrix answers the second question. At a normal opening bank the
  // factory is still competing for tanks and batteries past the horizon, so a
  // starved commander would fail this case for reasons that are not a reach
  // bug at all.
  scenario.settings.startingMats = 20000;
  scenario.settings.startingReq = 1000;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = nation;
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'lithuania';
  scenario.players[1].startX = SIZE - 9;
  scenario.players[1].startZ = SIZE - 9;
  scenario.players[1].isAI = false;

  // Two deposits inside the opening build: twelve tiles at three loads each is
  // enough that a five-hull production run is limited by the factory, not the
  // bank. Without a field the commander spends its opening mats and then earns
  // two a second, which stalls every purchase after the first minute.
  for (const [x, z] of [
    [16, 18], [17, 18], [18, 18], [16, 19], [17, 19], [18, 19],
    [4, 26], [5, 26], [6, 26], [4, 27], [5, 27], [6, 27],
  ]) {
    scenario.tiles[z * SIZE + x].o = 900;
  }

  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'barracks', owner: 0, x: 12, z: 6 },
    { defId: 'factory', owner: 0, x: 12, z: 12 },
    { defId: 'airfield', owner: 0, x: 20, z: 8 },
    { defId: 'heliport', owner: 0, x: 20, z: 18 },
    { defId: 'refinery', owner: 0, x: 6, z: 14 },
    { defId: 'supplyDepot', owner: 0, x: 6, z: 20 },
    { defId: 'powerPlant', owner: 0, x: 12, z: 18 },
  );

  const rifle = resolveRoster(nation).units.find((id) => unitFamily(id) === 'rifle')!;
  scenario.units.push(
    { defId: 'engineer', owner: 0, x: 9, z: 9 },
    { defId: 'harvester', owner: 0, x: 8, z: 15 },
    { defId: 'harvester', owner: 0, x: 9, z: 16 },
  );
  for (let i = 0; i < 6; i++) {
    scenario.units.push({ defId: rifle, owner: 0, x: 10 + (i % 3), z: 22 + Math.floor(i / 3) });
  }

  // The enemy has to exist or the match is decided at tick zero, and it has to
  // survive the horizon or victory closes the field before procurement is done.
  // A ridge line around its command post does both: every ground class treats
  // rock as impassable, so the attack waves cannot end the match, and it is not
  // water, so the commander does not spend the bank on a fleet it does not need
  // here. Ground attack is what victory turns on, so the case measures buying
  // the kit rather than racing a stopwatch against a raid.
  for (let x = SIZE - 10; x < SIZE; x++) {
    for (let z = SIZE - 10; z < SIZE; z++) {
      const edge = x === SIZE - 10 || x === SIZE - 1 || z === SIZE - 10 || z === SIZE - 1;
      if (edge) scenario.tiles[z * SIZE + x].t = Terrain.Rock;
    }
  }
  scenario.structures.push({ defId: 'commandPost', owner: 1, x: SIZE - 6, z: SIZE - 6 });

  const game = new Game(scenario, { enableAI: false });
  game.player(0)!.research.completed = RESEARCH.techs.map((tech) => tech.id);
  return game;
}

/** Everything this seat built, keyed by definition, with the tick it appeared. */
function fielded(game: Game, owner: number, seconds: number): Map<string, number> {
  const ai = new AIController();
  const state = initialAIState(7, 'elite');
  const built = new Map<string, number>();
  for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
    game.tick();
    ai.update(game, owner, state);
    for (const entity of game.entitiesOf(owner)) {
      if (entity.kind === 'building' && entity.construction) continue;
      if (!built.has(entity.defId)) built.set(entity.defId, game.state.tick);
    }
  }
  return built;
}

function report(built: Map<string, number>, ids: readonly string[]): string {
  return ids
    .map((id) => {
      const tick = built.get(id);
      return `${id} ${tick === undefined ? 'never' : `at ${Math.round(tick / 20)} s`}`;
    })
    .join(', ');
}

describe('national kit reach', () => {
  it('fields every nation’s replacement and exclusive in an AI match', () => {
    expect(Object.keys(KITS).sort()).toEqual(NATION_LIST.map((nation) => nation.id).sort());
    for (const nation of NATION_LIST) {
      const kit = KITS[nation.id];
      const built = fielded(landArena(nation.id), 0, HORIZON_SECONDS);
      const ids = [kit.replacement, kit.exclusive];
      // Named individually so a failure says which half of the kit is missing.
      expect(built.has(kit.replacement), `${nation.id} replacement (${report(built, ids)})`).toBe(
        true,
      );
      expect(built.has(kit.exclusive), `${nation.id} exclusive (${report(built, ids)})`).toBe(true);
      // No other nation's kit may appear on this field. The roster suite proves
      // the gate, and this proves the production plan goes through it.
      for (const other of NATION_LIST) {
        if (other.id === nation.id) continue;
        const foreign = KITS[other.id];
        expect(built.has(foreign.replacement), `${nation.id} fielded ${foreign.replacement}`).toBe(
          false,
        );
        expect(built.has(foreign.exclusive), `${nation.id} fielded ${foreign.exclusive}`).toBe(
          false,
        );
      }
    }
  }, 600_000);

  it('fields the national naval hull where there is water for it', () => {
    for (const [nation, hull] of Object.entries(HULLS)) {
      const game = new Game(harbourWith(nation), { enableAI: false });
      game.player(0)!.research.completed = RESEARCH.techs.map((tech) => tech.id);
      // The hull is a shipyard unit and the yard already stands, so only the
      // production order is under test; the bank has to cover a hull and the
      // escort the commander buys with it.
      game.player(0)!.mats = 6000;
      game.player(0)!.req = 1000;
      const built = fielded(game, 0, HARBOUR_HORIZON_SECONDS);
      expect(built.has(hull), `${nation} ${hull} (${report(built, [hull])})`).toBe(true);
    }
  }, 300_000);

  it('names a reach case for every national unit in the catalogue', () => {
    const covered = new Set([
      ...Object.values(KITS).flatMap((kit) => [kit.replacement, kit.exclusive]),
      ...Object.values(HULLS),
    ]);
    for (const nation of NATION_LIST) {
      for (const id of resolveRoster(nation.id).units) {
        if (!UNITS[id]?.national) continue;
        expect(covered.has(id), `${nation.id} ${id} has no reach case`).toBe(true);
      }
    }
  });
});
