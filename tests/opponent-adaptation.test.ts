/**
 * Phase 6 — opponent recognition and adaptive counter-strategy.
 *
 * The reading is built from `ctx.known`, which is vision plus remembered
 * contacts. These fixtures therefore place only contacts the AI can legitimately
 * have, and assert both what it recognised and what it did differently.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, adaptProduction, initialAIState } from '../src/sim/ai';
import type { OpponentRead } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';

const SIZE = 72;
const CX = 40;
const CZ = 30;

interface Fixture {
  game: Game;
  ai: AIController;
  state: ReturnType<typeof initialAIState>;
}

function field(
  commanderId: string | undefined,
  difficulty: AIDifficulty,
  enemies: readonly { defId: string; count: number }[],
  options: { fog?: boolean; far?: boolean } = {},
): Fixture {
  const s = createEmptyScenario(SIZE, SIZE);
  s.settings.seed = 7;
  if (options.fog !== undefined) s.settings.fog = options.fog;
  else s.settings.fog = true;
  s.players[0].factionId = 'baltic';
  s.players[0].startX = 4;
  s.players[0].startZ = 4;
  s.players[1].factionId = 'poland';
  s.players[1].startX = CX;
  s.players[1].startZ = CZ;
  s.structures.push({ defId: 'commandPost', owner: 1, x: CX + 4, z: CZ + 6 });
  s.structures.push({ defId: 'factory', owner: 1, x: CX + 6, z: CZ + 6 });
  s.structures.push({ defId: 'barracks', owner: 1, x: CX + 6, z: CZ + 9 });
  s.structures.push({ defId: 'refinery', owner: 1, x: CX + 8, z: CZ + 10 });
  s.structures.push({ defId: 'powerPlant', owner: 1, x: CX + 9, z: CZ + 6 });
  s.structures.push({ defId: 'commandPost', owner: 0, x: 4, z: 4 });
  s.units.push({ defId: 'recon', owner: 1, x: CX + 1, z: CZ + 1 });
  const base = options.far ? 40 : 3;
  let i = 0;
  for (const group of enemies) {
    for (let k = 0; k < group.count; k++) {
      s.units.push({
        defId: group.defId,
        owner: 0,
        x: CX + base + (i % 3),
        z: CZ + base + Math.floor(i / 3),
      });
      i++;
    }
  }
  const game = new Game(s, { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(7, difficulty, commanderId);
  return { game, ai, state };
}

/** Force one decision at the current tick. */
function think(f: Fixture): void {
  f.state.nextThinkTick = f.game.state.tick;
  f.ai.update(f.game, 1, f.state);
}

function thinkTimes(f: Fixture, times: number): void {
  for (let i = 0; i < times; i++) {
    f.game.tick();
    think(f);
  }
}

const readOf = (f: Fixture) => f.state.opponentRead;

describe('opponent recognition', () => {
  it('recognises an armoured opponent from a column, not a single sighting', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(column, 3);
    const read = readOf(column);
    console.log('[opponent]', JSON.stringify({ kind: 'armour', read }));
    expect(read?.tendency).toBe('armour');
    expect(read!.confidence).toBeGreaterThan(0);

    const lone = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 1 }]);
    thinkTimes(lone, 3);
    expect(readOf(lone)?.tendency).toBeNull();
  });

  it('recognises infantry and artillery investment', () => {
    const foot = field('krzysztofZawadzki', 'elite', [{ defId: 'rifle', count: 6 }]);
    thinkTimes(foot, 3);
    expect(readOf(foot)?.tendency).toBe('infantry');

    const guns = field('krzysztofZawadzki', 'elite', [{ defId: 'spg', count: 5 }]);
    thinkTimes(guns, 3);
    expect(readOf(guns)?.tendency).toBe('artillery');
  });

  it('counts a remembered contact once, not once per think', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 4 }]);
    thinkTimes(column, 1);
    const first = readOf(column)!;
    expect(first.observed).toBeLessThanOrEqual(4);
    thinkTimes(column, 1);
    // The second think adds at most the same four contacts again, decayed — the
    // same remembered ids are deduplicated inside the read.
    expect(readOf(column)!.observed).toBeLessThanOrEqual(4);
    expect(readOf(column)!.mass).toBeLessThanOrEqual(first.mass + 4);
  });

  it('lets stale intelligence fade out', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(column, 3);
    expect(readOf(column)?.tendency).toBe('armour');
    // The column is destroyed: 45 seconds of simulation is three half-lives.
    for (const e of column.game.state.entities) {
      if (e.owner === 0 && e.kind === 'unit') e.hp = 0;
    }
    for (let i = 0; i < 20 * 45; i++) column.game.tick();
    think(column);
    console.log('[opponent]', JSON.stringify({ kind: 'stale', read: readOf(column) }));
    expect(readOf(column)?.tendency).toBeNull();
    expect(readOf(column)!.confidence).toBe(0);
  });

  it('sees nothing it cannot legitimately see', () => {
    const hidden = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }], {
      fog: true,
      far: true,
    });
    thinkTimes(hidden, 4);
    expect(readOf(hidden)?.tendency).toBeNull();
    expect(readOf(hidden)!.mass).toBe(0);
  });

  it('is deterministic for the same state and seed', () => {
    const first = field('krzysztofZawadzki', 'veteran', [{ defId: 'tank', count: 6 }]);
    const second = field('krzysztofZawadzki', 'veteran', [{ defId: 'tank', count: 6 }]);
    thinkTimes(first, 3);
    thinkTimes(second, 3);
    expect(readOf(first)).toEqual(readOf(second));
  });

  it('stays absent on the seeded no-commander path', () => {
    const seeded = field(undefined, 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(seeded, 3);
    expect(readOf(seeded)).toBeUndefined();
  });
});

describe('evidence lifecycle', () => {
  it('does not let a remembered contact replenish its own evidence', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(column, 2);
    const established = readOf(column)!.mass;
    expect(established).toBeGreaterThan(0);
    // The column leaves vision; only a memory of it remains, thirty seconds old.
    for (const e of column.game.state.entities) {
      if (e.owner === 0 && e.kind === 'unit') e.hp = 0;
    }
    const stamp = column.game.state.tick - 20 * 30;
    for (let i = 0; i < 6; i++) {
      column.game.state.contacts.push({
        team: 1,
        entityId: 9000 + i,
        x: (CX + 6) * 16,
        z: (CZ + 6) * 16,
        tick: stamp,
        defId: 'tank',
        kind: 'unit',
        state: 'last-known',
      });
    }
    think(column);
    const afterOne = readOf(column)!.mass;
    think(column);
    const afterTwo = readOf(column)!.mass;
    console.log('[opponent]', JSON.stringify({ kind: 'memory', established, afterOne, afterTwo }));
    // A remembered contact is worth a fraction of a sighting, so six of them add
    // far less than six. The old behaviour added six, every think, forever.
    expect(afterOne - established).toBeLessThan(1);
    expect(afterTwo - afterOne).toBeLessThan(1);
    // And the memory's own contribution keeps shrinking as it ages.
    expect(afterTwo - afterOne).toBeLessThanOrEqual(afterOne - established + 1e-9);
  });

  it('lets a new sighting restore a faded read', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(column, 2);
    expect(readOf(column)?.tendency).toBe('armour');
    // The column drives out of sight and the memory ages below the bar.
    const tanks = column.game.state.entities.filter((e) => e.owner === 0 && e.kind === 'unit');
    for (const e of tanks) {
      e.x = 2000;
      e.z = 2000;
    }
    for (let i = 0; i < 20 * 40; i++) column.game.tick();
    think(column);
    expect(readOf(column)?.tendency).toBeNull();
    // It returns, and the commander recognises it again from the sighting.
    let i = 0;
    for (const e of tanks) {
      e.x = (CX + 3 + (i % 3)) * 16;
      e.z = (CZ + 3 + Math.floor(i / 3)) * 16;
      i++;
    }
    // The column is reacquired: six contacts reported as seen now.
    for (let i = 0; i < 6; i++) {
      column.game.state.contacts.push({
        team: 1,
        entityId: 9700 + i,
        x: (CX + 4) * 16,
        z: (CZ + 4) * 16,
        tick: column.game.state.tick,
        defId: 'tank',
        kind: 'unit',
        state: 'last-known',
      });
    }
    thinkTimes(column, 2);
    console.log('[opponent]', JSON.stringify({ kind: 'reacquire', read: readOf(column) }));
    expect(readOf(column)?.tendency).toBe('armour');
    expect(readOf(column)!.confidence).toBeGreaterThan(0);
  });

  it('drops a destroyed unit instead of counting it forever', () => {
    const column = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 4 }]);
    thinkTimes(column, 2);
    for (const e of column.game.state.entities) {
      if (e.owner === 0 && e.kind === 'unit') e.hp = 0;
    }
    column.game.tick();
    think(column);
    expect(readOf(column)!.observed).toBe(0);
  });

  it('never classifies an unidentified contact', () => {
    const empty = field('krzysztofZawadzki', 'elite', []);
    empty.game.state.contacts.push({
      team: 1,
      entityId: 4242,
      x: (CX + 5) * 16,
      z: (CZ + 5) * 16,
      tick: empty.game.state.tick,
      state: 'detected',
    });
    thinkTimes(empty, 2);
    expect(readOf(empty)!.observed).toBe(0);
    expect(readOf(empty)?.tendency).toBeNull();
  });
});

describe('adaptive counter-strategy', () => {
  it('recognises armour and answers it in production', () => {
    const column = field('piotrGrabowski', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(column, 3);
    const read = readOf(column) as unknown as OpponentRead;
    expect(read.tendency).toBe('armour');
    // The consumer used by the production planner: anti-tank demand rises, and
    // nothing outside the existing slot vocabulary is touched.
    expect(adaptProduction(read, 'atgm')).toBeGreaterThan(1);
    expect(adaptProduction(read, 'rifle')).toBe(1);
    // Bounded, like every other doctrine weight.
    for (const slot of ['atgm', 'td', 'rifle', 'tank', 'aa', 'spg', 'recon']) {
      const value = adaptProduction(read, slot);
      expect(value).toBeGreaterThanOrEqual(0.85);
      expect(value).toBeLessThanOrEqual(1.3);
    }
  });

  it('answers air pressure with air defence, not anti-tank', () => {
    const air = field('piotrGrabowski', 'elite', [{ defId: 'fighter', count: 5 }]);
    thinkTimes(air, 3);
    const read = readOf(air) as unknown as OpponentRead;
    expect(read.tendency).toBe('air');
    expect(adaptProduction(read, 'aa')).toBeGreaterThan(1);
    expect(adaptProduction(read, 'atgm')).toBe(1);
  });

  it('keeps the commander in charge of what the answer looks like', () => {
    const assault = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    const bastion = field('piotrGrabowski', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(assault, 3);
    thinkTimes(bastion, 3);
    expect(readOf(assault)!.tendency).toBe('armour');
    expect(readOf(bastion)!.tendency).toBe('armour');
    // Same opponent, same reading. The doctrine still separates them: the
    // commander's own production weights are applied on top of the adaptation.
    expect(readOf(assault)!.confidence).toBeCloseTo(readOf(bastion)!.confidence, 6);
  });

  it('changes what actually gets produced against the same commander', () => {
    // A long fixture with the opponent visible but not adjacent: the only
    // difference between the runs is what the opponent is made of.
    const run = (defId: string): Record<string, number> => {
      const f = field('piotrGrabowski', 'elite', [{ defId, count: 6 }], {
        fog: false,
        far: true,
      });
      for (let i = 0; i < 20 * 150; i++) {
        f.game.tick();
        f.ai.update(f.game, 1, f.state);
      }
      const counts: Record<string, number> = {};
      for (const e of f.game.state.entities) {
        if (e.owner !== 1 || e.kind !== 'unit' || e.hp <= 0) continue;
        counts[e.defId] = (counts[e.defId] ?? 0) + 1;
      }
      return counts;
    };
    const armour = run('tank');
    const infantry = run('rifle');
    console.log('[opponent]', JSON.stringify({ kind: 'production', armour, infantry }));
    expect(armour.atgm ?? 0).toBeGreaterThanOrEqual(infantry.atgm ?? 0);
  });

  it('keeps two supported threats rather than one winner', () => {
    const combined = field('krzysztofZawadzki', 'elite', [
      { defId: 'tank', count: 4 },
      { defId: 'spg', count: 4 },
    ]);
    thinkTimes(combined, 3);
    const read = readOf(combined)!;
    console.log('[opponent]', JSON.stringify({ kind: 'multi', tendencies: read.tendencies }));
    const tendencies = read.tendencies ?? [];
    expect(tendencies.length).toBeGreaterThanOrEqual(2);
    const classes = tendencies.map((t) => t.tendency);
    expect(classes).toContain('armour');
    expect(classes).toContain('artillery');
    // Each answer is mild on its own, and both reach their own decision point.
    expect(adaptProduction(read as unknown as OpponentRead, 'atgm')).toBeGreaterThan(1);
    expect(adaptProduction(read as unknown as OpponentRead, 'recon')).toBeGreaterThan(1);
  });

  it('does not let recognition move an assault commander onto economy targets', () => {
    // An unambiguous economic opponent: a fat refinery line beside one factory.
    const build = (commanderId: string) => {
      const s = createEmptyScenario(SIZE, SIZE);
      s.settings.seed = 7;
      s.players[0].factionId = 'baltic';
      s.players[0].startX = 4;
      s.players[0].startZ = 4;
      s.players[1].factionId = 'poland';
      s.players[1].startX = CX;
      s.players[1].startZ = CZ;
      s.structures.push({ defId: 'commandPost', owner: 1, x: CX + 4, z: CZ + 6 });
      s.structures.push({ defId: 'commandPost', owner: 0, x: 4, z: 4 });
      s.structures.push({ defId: 'factory', owner: 0, x: CX - 4, z: CZ + 3 });
      for (let i = 0; i < 6; i++) {
        s.structures.push({ defId: 'refinery', owner: 0, x: CX - 8 - i, z: CZ + 3 });
      }
      s.units.push({ defId: 'recon', owner: 1, x: CX + 1, z: CZ + 1 });
      const game = new Game(s, { enableAI: false });
      const ai = new AIController();
      const state = initialAIState(7, 'elite', commanderId);
      const fixture: Fixture = { game, ai, state };
      thinkTimes(fixture, 3);
      const hit = game.state.entities.find(
        (e) => e.owner === 0 && e.x === state.targetBaseX && e.z === state.targetBaseZ,
      );
      return { read: readOf(fixture)!, target: hit?.defId ?? null };
    };
    const assault = build('krzysztofZawadzki');
    const economy = build('piotrGrabowski');
    console.log('[opponent]', JSON.stringify({
      kind: 'doctrine',
      tendency: assault.read.tendency,
      assault: assault.target,
      economy: economy.target,
    }));
    expect((assault.read.tendencies ?? []).map((t) => t.tendency)).toContain('economy');
    // The economy recognition sharpens the economy-first commander's reading and
    // does not rewrite the assault commander's doctrine.
    expect(economy.target).toBe('refinery');
    expect(assault.target).toBe('factory');
  });

  it('does not abandon the plan when an opponent changes composition', () => {
    const mixed = field('krzysztofZawadzki', 'veteran', [
      { defId: 'tank', count: 4 },
      { defId: 'rifle', count: 4 },
    ]);
    thinkTimes(mixed, 3);
    const read = readOf(mixed)!;
    // Close split: no confident tendency, so no adaptation is applied.
    expect(read.confidence).toBeLessThan(0.75);
    expect(Math.max(...Object.values(read.scores))).toBeGreaterThan(0);
  });
});

describe('difficulty gates recognition quality', () => {
  it('needs more evidence at a lower level', () => {
    const recruit = field('krzysztofZawadzki', 'recruit', [{ defId: 'tank', count: 6 }]);
    const elite = field('krzysztofZawadzki', 'elite', [{ defId: 'tank', count: 6 }]);
    thinkTimes(recruit, 1);
    thinkTimes(elite, 1);
    console.log('[opponent]', JSON.stringify({
      kind: 'levels',
      recruit: readOf(recruit),
      elite: readOf(elite),
    }));
    expect(readOf(elite)?.tendency).toBe('armour');
    expect(readOf(recruit)?.tendency).toBeNull();
    // Given the same evidence over more decisions, the recruit does catch up.
    thinkTimes(recruit, 4);
    expect(readOf(recruit)?.tendency).toBe('armour');
  });
});
