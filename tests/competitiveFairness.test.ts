/**
 * Phase 6D — competitive fairness.
 *
 * Two separate questions, kept separate on purpose:
 *   1. Is the map geometry equivalent from both starting slots? (always runs)
 *   2. Does the observed weakness follow the seat or the faction? (gated)
 *
 * The Phase 6C.1 benchmark assigned Baltic to player 0 and Expeditionary to
 * player 1, then reported "east is weaker". Two variables moved together, so the
 * result could not tell a seat problem from a roster problem. The matrix below
 * separates them by swapping one thing at a time.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import {
  createOpenFront,
  createWoodlandDivide,
  footprintOf,
  rotatePoint,
  rotateRect,
} from '../src/data/competitiveMaps';
import { TERRAIN } from '../src/sim/terrain';
import type { TerrainId } from '../src/sim/terrain';
import type { Scenario } from '../src/sim/scenario';
import { AIController, initialAIState } from '../src/sim/ai';

declare const process: { env: Record<string, string | undefined> };
const RUN = process.env.SEAT_BENCH === '1';
const SWAP = process.env.SWAP_BENCH === '1';

/**
 * Reverse the player-index-to-position assignment without touching the map.
 *
 * Ownership of the two bases is exchanged in place: every entity keeps its exact
 * coordinates and changes hands. Nothing is rotated, so the physical battlefield
 * is byte-identical to the unswapped scenario, and player 0 now mans the eastern
 * base with the eastern roster. The players keep their identities but take the
 * other's start tile and faction. Tiles, ore, props and neutral structures are
 * untouched.
 */
export function swapAssignments(scenario: Scenario): void {
  void footprintOf;
  void rotatePoint;
  void rotateRect;
  for (const s of scenario.structures) {
    if (s.owner !== 0 && s.owner !== 1) continue;
    s.owner = s.owner === 0 ? 1 : 0;
  }
  for (const u of scenario.units) {
    if (u.owner !== 0 && u.owner !== 1) continue;
    u.owner = u.owner === 0 ? 1 : 0;
  }
  const p0 = scenario.players[0];
  const p1 = scenario.players[1];
  [p0.startX, p1.startX] = [p1.startX!, p0.startX!];
  [p0.startZ, p1.startZ] = [p1.startZ!, p0.startZ!];
  [p0.factionId, p1.factionId] = [p1.factionId, p0.factionId];
}

interface StartAudit {
  slot: number;
  x: number;
  z: number;
  buildableNear10: number;
  buildableNear16: number;
  oreTilesNear20: number;
  oreInMap: number;
  nearestOre: number;
  distanceToCentre: number;
}

function auditStart(scenario: Scenario, slot: number): StartAudit {
  const start = scenario.slots?.[slot] ?? { x: scenario.width / 2, z: scenario.height / 2 };
  const width = scenario.width;
  const buildable = (r: number): number => {
    let n = 0;
    for (let z = Math.max(0, start.z - r); z <= Math.min(scenario.height - 1, start.z + r); z++) {
      for (let x = Math.max(0, start.x - r); x <= Math.min(width - 1, start.x + r); x++) {
        if (Math.hypot(x - start.x, z - start.z) > r) continue;
        const tile = scenario.tiles[z * width + x];
        const def = TERRAIN[tile.t as TerrainId];
        if (!def?.buildable || def.water) continue;
        n++;
      }
    }
    return n;
  };
  let oreTiles = 0;
  let nearest = Infinity;
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < width; x++) {
      const tile = scenario.tiles[z * width + x];
      if ((tile.o ?? 0) <= 0) continue;
      const d = Math.hypot(x - start.x, z - start.z);
      if (d <= 20) oreTiles++;
      if (d < nearest) nearest = d;
    }
  }
  return {
    slot,
    x: start.x,
    z: start.z,
    buildableNear10: buildable(10),
    buildableNear16: buildable(16),
    oreTilesNear20: oreTiles,
    oreInMap: scenario.tiles.filter((t) => (t.o ?? 0) > 0).length,
    nearestOre: Math.round(nearest * 10) / 10,
    distanceToCentre: Math.round(Math.hypot(start.x - width / 2, start.z - scenario.height / 2) * 10) / 10,
  };
}

describe('competitive map symmetry', () => {
  for (const [name, make] of [
    ['Open Front', createOpenFront],
    ['Woodland Divide', createWoodlandDivide],
  ] as const) {
    it(`audits both starting slots on ${name}`, () => {
      const scenario = make();
      const west = auditStart(scenario, 0);
      const east = auditStart(scenario, 2);
      console.log('[fair]', JSON.stringify({
        kind: 'map-start',
        map: name,
        slots: scenario.slots,
        west,
        east,
        buildableDelta: west.buildableNear16 - east.buildableNear16,
        oreDelta: west.oreTilesNear20 - east.oreTilesNear20,
      }));
      // Both slots must at least sit on ground a base can be built on.
      expect(west.buildableNear10).toBeGreaterThan(0);
      expect(east.buildableNear10).toBeGreaterThan(0);
      // Recorded, not asserted equal: the maps are hand-authored, and a real
      // difference is a finding for the report rather than a test failure.
      expect(Number.isFinite(west.nearestOre)).toBe(true);
      expect(Number.isFinite(east.nearestOre)).toBe(true);
    });
  }
});

interface MatchOutcome {
  map: string;
  seed: number;
  p0Faction: string;
  p1Faction: string;
  p0Seat: 'west' | 'east';
  p1Seat: 'west' | 'east';
  config?: string;
  victory: string;
  seconds: number;
  p0: { structures: number; supply: number; mats: number; req: number; army: number; harvesters: number };
  p1: { structures: number; supply: number; mats: number; req: number; army: number; harvesters: number };
}

function sideOf(game: Game, owner: number) {
  let structures = 0;
  let army = 0;
  let harvesters = 0;
  for (const e of game.state.entities) {
    if (e.owner !== owner || e.hp <= 0) continue;
    if (e.kind === 'building') structures++;
    else if (e.defId === 'harvester') harvesters++;
    else army += 100;
  }
  const power = game.powerStatus(owner);
  return {
    structures,
    supply: power.supply,
    mats: Math.round(game.player(owner)?.mats ?? 0),
    req: Math.round(game.player(owner)?.req ?? 0),
    army,
    harvesters,
  };
}

function play(
  name: string,
  make: () => Scenario,
  seed: number,
  f0: string,
  f1: string,
  swapped = false,
): MatchOutcome {
  const scenario = make();
  scenario.settings.seed = seed;
  scenario.players[0].factionId = f0;
  scenario.players[1].factionId = f1;
  if (swapped) swapAssignments(scenario);
  const game = new Game(scenario, { enableAI: false });
  const a = new AIController();
  const b = new AIController();
  const sa = initialAIState(seed, 'veteran');
  const sb = initialAIState(seed, 'veteran');
  // A bounded clock: long enough for a decided match to finish, short enough
  // that eight of them fit in one benchmark window. A match that hits it is
  // reported as still playing, not relabelled as complete.
  for (let i = 0; i < 20 * 900 && game.state.victory === 'playing'; i++) {
    game.tick();
    a.update(game, 0, sa);
    b.update(game, 1, sb);
  }
  return {
    map: name,
    seed,
    p0Faction: scenario.players[0].factionId,
    p1Faction: scenario.players[1].factionId,
    p0Seat: swapped ? 'east' : 'west',
    p1Seat: swapped ? 'west' : 'east',
    victory: game.state.victory,
    seconds: Math.round(game.state.tick / 20),
    p0: sideOf(game, 0),
    p1: sideOf(game, 1),
  };
}

describe.skipIf(!RUN)('seat and faction swap matrix', () => {
  it('separates seat effects from roster effects', () => {
    // The full two-seed, four-configuration matrix Phase 6D left unfinished.
    const matches: MatchOutcome[] = [];
    for (const seed of [11, 23]) {
      matches.push(play('Open Front', createOpenFront, seed, 'baltic', 'expeditionary'));
      matches.push(play('Open Front', createOpenFront, seed, 'expeditionary', 'baltic'));
      matches.push(play('Open Front', createOpenFront, seed, 'baltic', 'baltic'));
      matches.push(play('Open Front', createOpenFront, seed, 'expeditionary', 'expeditionary'));
    }
    console.log('[fair]', JSON.stringify({ kind: 'seat-matrix', matches }));
    expect(matches).toHaveLength(8);
    for (const match of matches) expect(match.seconds).toBeGreaterThan(0);
  }, 1_800_000);
});

function tileChecksum(scenario: Scenario): number {
  let sum = 0;
  for (const t of scenario.tiles) sum = (sum * 31 + t.t * 7 + t.e * 3 + (t.o ?? 0) + (t.v ?? 0)) % 1_000_000_007;
  return sum;
}

function hqSeat(scenario: Scenario, owner: number): 'west' | 'east' | 'missing' {
  const hq = scenario.structures.find((s) => s.owner === owner && s.defId === 'commandPost');
  if (!hq) return 'missing';
  return hq.x < scenario.width / 2 ? 'west' : 'east';
}

describe('assignment swap harness', () => {
  for (const [name, make] of [
    ['Open Front', createOpenFront],
    ['Woodland Divide', createWoodlandDivide],
  ] as const) {
    it(`puts player 0 on the eastern base on ${name} without moving the map`, () => {
      const base = make();
      const before = tileChecksum(base);
      const widthBefore = base.width;
      const heightBefore = base.height;
      const baseHq0 = hqSeat(base, 0);
      const baseHq1 = hqSeat(base, 1);
      const baseFaction0 = base.players[0].factionId;
      const baseFaction1 = base.players[1].factionId;
      const westStart = { x: base.players[0].startX, z: base.players[0].startZ };
      const eastStart = { x: base.players[1].startX, z: base.players[1].startZ };

      swapAssignments(base);

      console.log('[fair]', JSON.stringify({
        kind: 'swap-audit',
        map: name,
        baseHq0, baseHq1,
        swappedHq0: hqSeat(base, 0), swappedHq1: hqSeat(base, 1),
        p0Start: base.players[0].startX, p1Start: base.players[1].startX,
      }));
      // Ownership really moved: player 0 mans the east base, player 1 the west.
      expect(baseHq0).toBe('west');
      expect(baseHq1).toBe('east');
      expect(hqSeat(base, 0)).toBe('east');
      expect(hqSeat(base, 1)).toBe('west');
      // The physical map did not move.
      expect(base.width).toBe(widthBefore);
      expect(base.height).toBe(heightBefore);
      expect(tileChecksum(base)).toBe(before);
      // Start tiles exchanged exactly with the physical bases.
      expect(base.players[0].startX).toBe(eastStart.x);
      expect(base.players[0].startZ).toBe(eastStart.z);
      expect(base.players[1].startX).toBe(westStart.x);
      expect(base.players[1].startZ).toBe(westStart.z);
      // Faction follows the physical position: the east roster now belongs to
      // player 0, so a matched pair keeps Baltic west and Expeditionary east.
      expect(base.players[0].factionId).toBe(baseFaction1);
      expect(base.players[1].factionId).toBe(baseFaction0);
      // Entities carry the new ownership, and the count is preserved: the swap
      // must not create or destroy anything.
      const owned = base.structures.filter((s) => s.owner === 0 || s.owner === 1).length;
      const ownedBefore = make().structures.filter((s) => s.owner === 0 || s.owner === 1).length;
      expect(owned).toBe(ownedBefore);
    });
  }
});

describe.skipIf(!SWAP)('32-match assignment matrix', () => {
  it('separates player index from physical seat on both maps', () => {
    const matches: MatchOutcome[] = [];
    const configs: Array<[string, string, string]> = [
      ['baltic', 'expeditionary', 'baltic-west'],
      ['expeditionary', 'baltic', 'expeditionary-west'],
      ['baltic', 'baltic', 'baltic-mirror'],
      ['expeditionary', 'expeditionary', 'expeditionary-mirror'],
    ];
    for (const [name, make] of [
      ['Open Front', createOpenFront],
      ['Woodland Divide', createWoodlandDivide],
    ] as const) {
      for (const seed of [11, 23]) {
        for (const [west, east, label] of configs) {
          for (const swapped of [false, true]) {
            const match = play(name, make, seed, west, east, swapped);
            matches.push({ ...match, config: label + (swapped ? '/p0-east' : '/p0-west') } as MatchOutcome);
          }
        }
      }
    }
    console.log('[fair]', JSON.stringify({ kind: 'swap-matrix', matches }));
    expect(matches).toHaveLength(32);
    for (const match of matches) expect(match.seconds).toBeGreaterThan(0);
  }, 7_200_000);
});
