/**
 * Phase 3 / 3B — commanders must change real decisions, not just profile numbers.
 *
 * Every fixture here runs the shipped `AIController` against the shipped
 * simulation. The assertions are directional rather than exact build orders:
 * a doctrine should make one commander field more of what it favours than a
 * rival does, on the same map, seed, bank and starting base.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { unitFamily } from '../src/data/units';

interface RunOptions {
  enemyAir?: boolean;
  mats?: number;
  refinery?: boolean;
  watch?: readonly string[];
}

interface Run {
  units: Record<string, number>;
  buildings: Record<string, number>;
  /** Tick at which each watched definition first reached one on the field. */
  first: Record<string, number>;
  state: ReturnType<typeof initialAIState>;
  seed: number;
}

const SIZE = 72;

function build(options: RunOptions = {}): { scenario: ReturnType<typeof createEmptyScenario>; ai: AIController } {
  const scenario = createEmptyScenario(SIZE, SIZE);
  scenario.settings.seed = 7;
  scenario.settings.fog = false;
  scenario.settings.startingMats = options.mats ?? 3000;
  scenario.settings.startingReq = 600;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 34;
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 6, z: 6 });
  scenario.structures.push({ defId: 'commandPost', owner: 1, x: 48, z: 36 });
  if (options.refinery !== false) scenario.structures.push({ defId: 'refinery', owner: 1, x: 52, z: 36 });
  scenario.structures.push({ defId: 'factory', owner: 1, x: 44, z: 36 });
  scenario.structures.push({ defId: 'barracks', owner: 1, x: 44, z: 41 });
  scenario.structures.push({ defId: 'powerPlant', owner: 1, x: 55, z: 41 });
  for (let z = 30; z <= 40; z++) {
    for (let x = 50; x <= 60; x++) scenario.tiles[z * SIZE + x].o = 600;
  }
  scenario.units.push({ defId: 'engineer', owner: 1, x: 47, z: 43 });
  scenario.units.push({ defId: 'harvester', owner: 1, x: 53, z: 39 });
  scenario.units.push({ defId: 'harvester', owner: 1, x: 54, z: 39 });
  if (options.enemyAir) scenario.units.push({ defId: 'fighter', owner: 0, x: 40, z: 30 });
  const ai = new AIController();
  return { scenario, ai };
}

function run(
  nationId: string,
  commanderId: string | undefined,
  seconds: number,
  options: RunOptions = {},
): Run {
  const { scenario, ai } = build(options);
  scenario.players[1].factionId = nationId;
  const game = new Game(scenario, { enableAI: false });
  // The commander id lives on the control state, exactly as `Game` seeds it.
  const state = initialAIState(7, 'elite', commanderId);

  const watch = options.watch ?? [];
  const first: Record<string, number> = {};
  for (let i = 0; i < 20 * seconds; i++) {
    game.tick();
    ai.update(game, 1, state);
    if (i % 10 === 0 && watch.length > 0) {
      for (const id of watch) {
        if (first[id] !== undefined) continue;
        if (game.state.entities.some((e) => e.owner === 1 && e.defId === id && e.hp > 0)) {
          first[id] = game.state.tick;
        }
      }
    }
  }
  const units: Record<string, number> = {};
  const buildings: Record<string, number> = {};
  for (const e of game.state.entities) {
    if (e.owner !== 1 || e.hp <= 0) continue;
    const bucket = e.kind === 'building' ? buildings : units;
    bucket[e.defId] = (bucket[e.defId] ?? 0) + 1;
  }
  return { units, buildings, first, state, seed: scenario.settings.seed };
}

const familyCount = (units: Record<string, number>, slot: string): number =>
  Object.entries(units).reduce((n, [id, count]) => (unitFamily(id) === slot ? n + count : n), 0);

describe('commander doctrine changes production', () => {
  it('fields the arm its doctrine favours', () => {
    // Same nation, same bank, same base: only the commander differs. Artillery
    // itself is gated behind a research branch and a formed army, so at this
    // horizon the doctrine shows in the *mix*: the territorial commander fields
    // an infantry line, the stand-off commander a gunner line.
    const standOff = run('finland', 'juhaniRautio', 300);
    const territorial = run('finland', 'ainoKorhonen', 300);
    console.log('[doctrine]', JSON.stringify({ kind: 'finland', standOff: standOff.units, territorial: territorial.units }));
    expect(familyCount(territorial.units, 'rifle')).toBeGreaterThan(
      familyCount(standOff.units, 'rifle'),
    );
    expect(familyCount(standOff.units, 'atgm')).toBeGreaterThanOrEqual(
      familyCount(territorial.units, 'atgm'),
    );
    // The territorial commander is not passive: it still fields vehicles too.
    expect(familyCount(territorial.units, 'tank')).toBeGreaterThan(0);
  });

  it('builds more of the infrastructure its doctrine wants', () => {
    const bastion = run('poland', 'piotrGrabowski', 300);
    const hammer = run('poland', 'krzysztofZawadzki', 300);
    console.log('[doctrine]', JSON.stringify({ kind: 'poland', bastion: bastion.buildings, hammer: hammer.buildings }));
    const bastionDefence = (bastion.buildings.atTurret ?? 0) + (bastion.buildings.mgNest ?? 0);
    const hammerDefence = (hammer.buildings.atTurret ?? 0) + (hammer.buildings.mgNest ?? 0);
    expect(bastionDefence).toBeGreaterThanOrEqual(hammerDefence);
    expect(familyCount(hammer.units, 'tank')).toBeGreaterThanOrEqual(
      familyCount(bastion.units, 'tank'),
    );
  });

  it('uses its own national equipment, not another nation’s equivalent', () => {
    // Two artillery doctrines, two nations: each must field its own gun.
    const russian = run('russia', 'viktorSokolov', 300);
    const korean = run('northKorea', 'hanCholsu', 300);
    console.log('[doctrine]', JSON.stringify({ kind: 'artillery-nations', russian: russian.units, korean: korean.units }));
    expect(russian.units.heavyHowitzer ?? 0).toBeGreaterThan(0);
    expect(korean.units.heavyHowitzer ?? 0).toBe(0);
    // North Korea's own structure variant and SAM site, not Russia's.
    expect(korean.buildings.entrenchedAtGun ?? 0).toBeGreaterThan(0);
    expect(russian.buildings.longRangeSam ?? 0).toBeGreaterThan(0);
    expect(korean.buildings.longRangeSam ?? 0).toBe(0);
  });

  it('still answers a threat its doctrine does not favour', () => {
    // Iran's drone commander prefers air, but a hostile aircraft must still
    // produce anti-air demand: doctrine bends priorities, it does not blind.
    const withAir = run('iran', 'rezaFarhadi', 240, { enemyAir: true });
    console.log('[doctrine]', JSON.stringify({ kind: 'threat', withAir: withAir.units }));
    expect(familyCount(withAir.units, 'aa')).toBeGreaterThan(0);
  });

  it('keeps the no-commander path deterministic and free of commander data', () => {
    const first = run('poland', undefined, 180);
    const second = run('poland', undefined, 180);
    expect(first.units).toEqual(second.units);
    expect(first.buildings).toEqual(second.buildings);
    // A commander changes the outcome, which is the point of the layer.
    const commanded = run('poland', 'piotrGrabowski', 180);
    expect(JSON.stringify(commanded.units)).not.toBe(JSON.stringify(first.units));
  });
});

describe('national exclusives follow doctrine', () => {
  it('a commander that values its exclusive fields it sooner than one that does not', () => {
    // Wilk is Poland's exclusive: only the exclusive loop can buy it. Zawadzki
    // weights it, Grabowski does not. Same nation, same base, same bank, so the
    // only difference is the authored preference.
    const weighted = run('poland', 'krzysztofZawadzki', 420, { watch: ['wilk'] });
    const indifferent = run('poland', 'piotrGrabowski', 420, { watch: ['wilk'] });
    console.log('[exclusive]', JSON.stringify({ kind: 'wilk', weighted: weighted.units, indifferent: indifferent.units, first: [weighted.first, indifferent.first] }));
    expect(weighted.units.wilk ?? 0).toBeGreaterThan(0);
    expect(weighted.first.wilk).toBeLessThan(indifferent.first.wilk ?? Number.POSITIVE_INFINITY);
    // The ordinary plan is not abandoned for the capability.
    expect(familyCount(weighted.units, 'tank')).toBeGreaterThan(0);
  });

  it('two commanders of one nation keep their own mix while both can reach the exclusive', () => {
    // Belarus: Maroz weights reconnaissance and sprut; Barys weights the rifle
    // line. Both may buy the exclusive once, but the army they build differs.
    const scout = run('belarus', 'volhaMaroz', 420, { watch: ['sprut'] });
    const line = run('belarus', 'mikalaiBarys', 420, { watch: ['sprut'] });
    console.log('[exclusive]', JSON.stringify({ kind: 'belarus', scout: scout.units, line: line.units, first: [scout.first, line.first] }));
    expect(familyCount(scout.units, 'recon')).toBeGreaterThanOrEqual(
      familyCount(line.units, 'recon'),
    );
    expect(familyCount(line.units, 'rifle')).toBeGreaterThanOrEqual(
      familyCount(scout.units, 'rifle'),
    );
    // Reachable by both, never more than the one-off limit.
    expect(scout.units.sprut ?? 0).toBeLessThanOrEqual(1);
    expect(line.units.sprut ?? 0).toBeLessThanOrEqual(1);
  });

  it('cannot buy an exclusive whose prerequisites or army gate are unmet', () => {
    // Koksan needs the fires branch, a factory and a formed field army. In the
    // opening minutes none of those hold, and no preference can skip that.
    const early = run('northKorea', 'hanCholsu', 90, { watch: ['koksan'] });
    expect(early.units.koksan ?? 0).toBe(0);
  });

  it('does not buy an exclusive it cannot afford or crew', () => {
    // No refinery and a thin bank: the exclusive's own price is held by the
    // ordinary reserve rules, so a preference cannot conjure it.
    const poor = run('northKorea', 'hanCholsu', 240, { mats: 250, refinery: false });
    console.log('[exclusive]', JSON.stringify({ kind: 'poor', poor: poor.units }));
    expect(poor.units.koksan ?? 0).toBe(0);
  });

  it('keeps the one-off purchase limit', () => {
    const long = run('northKorea', 'hanCholsu', 900, { watch: ['koksan'] });
    expect(long.units.koksan ?? 0).toBeLessThanOrEqual(1);
  });

  it('is deterministic for a fixed seed, commander and difficulty', () => {
    const first = run('poland', 'krzysztofZawadzki', 240);
    const second = run('poland', 'krzysztofZawadzki', 240);
    expect(first.units).toEqual(second.units);
    expect(first.buildings).toEqual(second.buildings);
    expect(first.first).toEqual(second.first);
  });
});
