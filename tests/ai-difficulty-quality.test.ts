/**
 * Phase 5 — difficulty is execution quality, never a gameplay advantage.
 *
 * Every fixture runs the shipped planner. The assertions compare decisions the
 * controller actually recorded: the contact it marches on, the army it demands,
 * the tick it notices a raid, and the raider it answers. Doctrine is asserted to
 * be identical across levels; only judgement is allowed to differ.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, aiProfile, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';

const SIZE = 72;
const CX = 40;
const CZ = 30;

interface Field {
  game: Game;
  state: ReturnType<typeof initialAIState>;
  chosen: string | null;
}

function battlefield(
  commanderId: string | undefined,
  difficulty: AIDifficulty,
  options: { raid?: boolean; ticks?: number } = {},
): Field {
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
  const put = (defId: string, dx: number, dz: number, kind: 'units' | 'structures'): void => {
    s[kind].push({ defId, owner: 0, x: CX + dx, z: CZ + dz } as never);
  };
  // The target fixture needs a spread of contact classes; the raid fixture does
  // not, because structures beside the base would be the nearest "threat" and
  // hide the raider choice under test.
  if (!options.raid) {
    put('factory', 3, 0, 'structures');
    put('refinery', -3, 0, 'structures');
    put('atTurret', 0, 3, 'structures');
    put('tank', 0, -3, 'units');
    put('spg', 2, 2, 'units');
    put('recon', -2, -2, 'units');
    put('aa', 2, -2, 'units');
    // Armour, not a hauler: keeps the opponent read out of the economy class so
    // this fixture measures doctrine and level, not Phase 6 adaptation.
    put('tank', -2, 2, 'units');
  }
  s.units.push({ defId: 'recon', owner: 1, x: CX + 1, z: CZ + 1 });
  if (options.raid) {
    // A scout closest to the base, and a tank slightly further out. Nearest is
    // the scout; the dangerous answer is the tank. The defender sits beside the
    // command post, far enough from the raiders to survive long enough to be
    // ordered.
    s.units.push({ defId: 'harvester', owner: 0, x: CX - 8, z: CZ + 6 });
    s.units.push({ defId: 'tank', owner: 0, x: CX - 10, z: CZ + 6 });
    s.units.push({ defId: 'tank', owner: 1, x: CX + 3, z: CZ + 5 });
  }
  const game = new Game(s, { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(7, difficulty, commanderId);
  for (let i = 0; i < (options.ticks ?? 200); i++) {
    game.tick();
    ai.update(game, 1, state);
  }
  const hit = game.state.entities.find(
    (e) =>
      e.owner === 0 &&
      Math.abs(e.x - state.targetBaseX) < 1 &&
      Math.abs(e.z - state.targetBaseZ) < 1,
  );
  return { game, state, chosen: state.targetKnown ? (hit?.defId ?? null) : null };
}

/** How long the level waits before its next decision, measured after a think. */
function decisionDelay(commanderId: string, difficulty: AIDifficulty): number {
  const { game, state } = battlefield(commanderId, difficulty, { raid: true, ticks: 12 });
  return state.nextThinkTick - game.state.tick;
}

describe('difficulty changes execution, not doctrine', () => {
  it('keeps the same strategy at every level', () => {
    const profiles = (['recruit', 'veteran', 'elite'] as AIDifficulty[]).map((difficulty) =>
      aiProfile(7, difficulty, 'krzysztofZawadzki'),
    );
    for (const profile of profiles) expect(profile.strategy).toBe(profiles[0]!.strategy);
    // The commander's own risk tolerance survives the level: still the most
    // aggressive profile in the nation at every difficulty.
    const other = (['recruit', 'veteran', 'elite'] as AIDifficulty[]).map(
      (difficulty) => aiProfile(7, difficulty, 'piotrGrabowski').aggression,
    );
    for (let i = 0; i < profiles.length; i++) {
      expect(profiles[i]!.aggression).toBeGreaterThan(other[i]!);
    }
  });

  it('lets judgement differ while the commander stays recognisable', () => {
    const recruit = battlefield('krzysztofZawadzki', 'recruit');
    const veteran = battlefield('krzysztofZawadzki', 'veteran');
    const elite = battlefield('krzysztofZawadzki', 'elite');
    console.log('[difficulty]', JSON.stringify({
      kind: 'targets',
      recruit: { chosen: recruit.chosen, army: recruit.state.desiredArmy },
      veteran: { chosen: veteran.chosen, army: veteran.state.desiredArmy },
      elite: { chosen: elite.chosen, army: elite.state.desiredArmy },
    }));
    // Doctrine: all three still want the same class of campaign. Quality: the
    // planned army reflects the level's own scale, not the commander's identity.
    expect(recruit.state.desiredArmy).toBeLessThan(elite.state.desiredArmy);
    expect(veteran.state.desiredArmy).toBeGreaterThanOrEqual(recruit.state.desiredArmy);
    // Grabowski keeps his economy-first reading once judgement is sound. At
    // recruit the noisy valuation may flip a near-tie, which is the level's own
    // inexperience, not a different doctrine.
    expect(battlefield('piotrGrabowski', 'elite').chosen).toBe('refinery');
    // Commander separation survives the level: at elite, the two Polish
    // commanders still disagree about what is worth attacking.
    expect(elite.chosen).not.toBe(battlefield('piotrGrabowski', 'elite').chosen);
  });

  it('notices a raid sooner at a higher level', () => {
    const recruit = decisionDelay('krzysztofZawadzki', 'recruit');
    const veteran = decisionDelay('krzysztofZawadzki', 'veteran');
    const elite = decisionDelay('krzysztofZawadzki', 'elite');
    console.log('[difficulty]', JSON.stringify({ kind: 'reaction', recruit, veteran, elite }));
    expect(recruit).toBeGreaterThan(0);
    expect(elite).toBeGreaterThan(0);
    expect(elite).toBeLessThan(recruit);
    expect(veteran).toBeLessThan(recruit);
  });

  it('answers the dangerous raider rather than the nearest one', () => {
    // The controller records what it answered ("defending base against tank"),
    // but later passes in the same think overwrite `lastDecision`, so the first
    // defensive answer is captured as it happens.
    const answer = (difficulty: AIDifficulty): string | null => {
      const field = battlefield('krzysztofZawadzki', difficulty, { raid: true, ticks: 1 });
      const ai = new AIController();
      for (let i = 1; i < 20 * 20; i++) {
        field.game.tick();
        ai.update(field.game, 1, field.state);
        // The order the defender is actually holding is the decision under test.
        const defender = field.game.state.entities.find(
          (e) => e.owner === 1 && e.defId === 'tank',
        );
        if (defender?.order?.type === 'attack') {
          const target = field.game.state.entities.find(
            (e) => e.id === (defender.order as { targetId: number }).targetId,
          );
          return target?.defId ?? null;
        }
      }
      return null;
    };
    const recruitTarget = answer('recruit');
    const eliteTarget = answer('elite');
    console.log('[difficulty]', JSON.stringify({ kind: 'threat', recruitTarget, eliteTarget }));
    expect(eliteTarget).toBe('tank');
    expect(recruitTarget).toBe('harvester');
  });

  it('gives no level extra information', () => {
    for (const difficulty of ['recruit', 'veteran', 'elite'] as AIDifficulty[]) {
      const field = battlefield('krzysztofZawadzki', difficulty);
      const hq = field.game.state.entities.find(
        (e) => e.owner === 0 && e.defId === 'commandPost',
      )!;
      expect(field.state.targetBaseX).not.toBe(hq.x);
      expect(field.state.targetBaseZ).not.toBe(hq.z);
    }
  });

  it('gives no level extra resources', () => {
    const fields = (['recruit', 'veteran', 'elite'] as AIDifficulty[]).map((difficulty) =>
      battlefield('krzysztofZawadzki', difficulty, { ticks: 1 }),
    );
    const starting = fields.map((f) => f.game.player(1)!.mats);
    expect(new Set(starting).size).toBe(1);
    // Prices come from the same catalogue for everyone.
    expect(fields[0]!.game.player(1)!.mats).toBe(fields[2]!.game.player(1)!.mats);
  });

  it('is deterministic per level', () => {
    const first = battlefield('viktorSokolov', 'elite', { ticks: 260 });
    const second = battlefield('viktorSokolov', 'elite', { ticks: 260 });
    expect(first.chosen).toBe(second.chosen);
    expect(first.state.desiredArmy).toBe(second.state.desiredArmy);
    expect(first.state.targetBaseX).toBe(second.state.targetBaseX);
  });

  it('leaves the seeded no-commander path on its historical judgement', () => {
    const recruit = battlefield(undefined, 'recruit');
    const elite = battlefield(undefined, 'elite');
    // No execution layer on the seeded path: same target at every level.
    expect(recruit.chosen).toBe(elite.chosen);
    expect(recruit.chosen).toBe('factory');
    // The level's own scale still applies, exactly as before Phase 5.
    expect(recruit.state.desiredArmy).toBeLessThan(elite.state.desiredArmy);
  });
});
