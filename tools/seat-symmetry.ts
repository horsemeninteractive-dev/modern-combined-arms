/**
 * Seat symmetry diagnostic.
 *
 * The national matchup harness found that the east seat wins about two thirds of
 * decided matches even though the arena is geometrically mirrored and every
 * pairing is played on both seats. This tool isolates the mechanism from
 * national rosters, AI personalities and map asymmetry:
 *
 *   1. a stationary 1v1 duel with no AI, no economy and no orders — the same
 *      fight with the two seats swapped and with the creation order reversed;
 *   2. a scripted mirrored advance with no AI, reporting the first tick at which
 *      the two halves stop being mirror images and which side is left standing.
 *
 *   npx tsx tools/seat-symmetry.ts
 *
 * It changes nothing in the simulation. It exists so a future engine change can
 * be measured against a documented baseline instead of a win-rate table.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';

const W = 64;
const H = 64;
const MIRROR_X = (x: number): number => W * TILE_SIZE - x;
const tileCenter = (tile: number): number => tile * TILE_SIZE + TILE_SIZE / 2;

interface ProbeUnit {
  defId: string;
  owner: number;
  x: number;
  z: number;
}

/** A bare arena with two command posts but no economy and no AI. */
function arena(units: ProbeUnit[]) {
  const s = createEmptyScenario(W, H);
  s.settings.fog = false;
  s.settings.startingMats = 0;
  s.settings.startingReq = 0;
  s.players[0].factionId = 'baltic';
  s.players[1].factionId = 'expeditionary';
  s.players[1].team = 1;
  s.structures = [
    { defId: 'commandPost', owner: 0, x: 10, z: 30 },
    { defId: 'commandPost', owner: 1, x: 50, z: 30 },
  ];
  s.units = units;
  return new Game(s, { enableAI: false });
}

/**
 * 1v1 duel with both hulls stationary in range. No movement, no AI and no
 * economy, so the only thing that can decide it is the order in which the two
 * identical weapons are resolved. `creation` selects which seat's entity is
 * created first, i.e. which one owns the lower entity id.
 */
function duel(westTile: number, eastTile: number, creation: 'west-first' | 'east-first') {
  const west: ProbeUnit = { defId: 'tank', owner: 0, x: westTile, z: 32 };
  const east: ProbeUnit = { defId: 'tank', owner: 1, x: eastTile, z: 32 };
  const game = arena(creation === 'west-first' ? [west, east] : [east, west]);
  const ids = {
    west: game.entitiesOf(0, 'unit').map((e) => e.id),
    east: game.entitiesOf(1, 'unit').map((e) => e.id),
  };
  for (let t = 0; t < 20 * 40 && game.state.victory === 'playing'; t++) {
    game.tick();
    if (game.entitiesOf(0, 'unit').length === 0 || game.entitiesOf(1, 'unit').length === 0) break;
  }
  const w = game.entitiesOf(0, 'unit')[0];
  const e = game.entitiesOf(1, 'unit')[0];
  return {
    creation,
    ids,
    winner: w && !e ? 'west' : e && !w ? 'east' : w && e ? 'stalemate' : 'double-kill',
    westHp: w ? Math.round(w.hp) : 0,
    eastHp: e ? Math.round(e.hp) : 0,
    seconds: +(game.state.tick / 20).toFixed(1),
  };
}

/**
 * Both sides are ordered to the other's starting point on the same tick. The
 * report is the first tick at which the two formations stop being exact mirror
 * images, plus which side is left standing.
 */
function scriptedAdvance() {
  const westTiles: Array<[number, number]> = [
    [20, 32],
    [20, 35],
    [18, 32],
  ];
  const west: ProbeUnit[] = westTiles.map(([x, z]) => ({
    defId: x === 18 ? 'rifle' : 'tank',
    owner: 0,
    x,
    z,
  }));
  const east: ProbeUnit[] = westTiles.map(([x, z]) => ({
    defId: x === 18 ? 'rifle' : 'tank',
    owner: 1,
    x: 63 - x,
    z,
  }));
  const game = arena([...west, ...east]);
  const startCounts = [game.entitiesOf(0, 'unit').length, game.entitiesOf(1, 'unit').length];
  let firstDivergence: string | null = null;
  for (let t = 0; t < 20 * 60 && game.state.victory === 'playing'; t++) {
    if (t === 30) {
      game.enqueueCommand({
        type: 'move',
        team: 0,
        ids: game.entitiesOf(0, 'unit').map((e) => e.id),
        x: tileCenter(43),
        z: tileCenter(32),
        attackMove: true,
      });
      game.enqueueCommand({
        type: 'move',
        team: 1,
        ids: game.entitiesOf(1, 'unit').map((e) => e.id),
        x: MIRROR_X(tileCenter(20)),
        z: tileCenter(32),
        attackMove: true,
      });
    }
    game.tick();
    const w = game.entitiesOf(0, 'unit').sort((a, b) => a.id - b.id);
    const e = game.entitiesOf(1, 'unit').sort((a, b) => a.id - b.id);
    let worst = 0;
    for (let i = 0; i < Math.min(w.length, e.length); i++) {
      worst = Math.max(
        worst,
        Math.abs(MIRROR_X(w[i].x) - e[i].x),
        Math.abs(w[i].z - e[i].z),
        Math.abs(w[i].hp - e[i].hp),
      );
    }
    if (
      !firstDivergence &&
      (worst > 0.01 || w.length !== startCounts[0] || e.length !== startCounts[1])
    ) {
      firstDivergence = `tick ${t} (${(t / 20).toFixed(2)} s), worst mirror error ${worst.toFixed(2)} px`;
    }
  }
  return {
    firstDivergence,
    westAlive: game.entitiesOf(0, 'unit').length,
    eastAlive: game.entitiesOf(1, 'unit').length,
    seconds: +(game.state.tick / 20).toFixed(1),
  };
}

console.log(JSON.stringify({ event: 'duels' }));
for (const creation of ['west-first', 'east-first'] as const) {
  for (const [wx, ex] of [
    [20, 25],
    [25, 20],
  ]) {
    console.log(
      JSON.stringify({ event: 'duel', westTile: wx, eastTile: ex, ...duel(wx, ex, creation) }),
    );
  }
}
console.log(JSON.stringify({ event: 'advance', ...scriptedAdvance() }));
