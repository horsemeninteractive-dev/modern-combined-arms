import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { WEAPONS } from '../src/data/weapons';
import { pickBestWeapon, weaponScore } from '../src/sim/weaponChoice';

/** A bare map with exactly two units, so nothing else can shoot or be shot. */
function duel(
  attacker: string,
  defender: string,
  tiles: number,
  options: { ammo?: number; seed?: number } = {},
): { game: Game; shots: Array<{ tick: number; weaponId: string }> } {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.fog = false;
  if (options.seed !== undefined) scenario.settings.seed = options.seed;
  scenario.units = [
    { defId: attacker, owner: 0, x: 20, z: 30 },
    { defId: defender, owner: 1, x: 20 + tiles, z: 30 },
  ];
  const game = new Game(scenario, { enableAI: false });
  const a = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 0)!;
  const b = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
  if (options.ammo !== undefined) {
    a.ammo = options.ammo;
    a.maxAmmo = Math.max(a.maxAmmo, options.ammo);
  }
  game.enqueueCommand({ type: 'attack', team: 0, ids: [a.id], targetId: b.id });
  const shots: Array<{ tick: number; weaponId: string }> = [];
  for (let i = 0; i < 20 * 8; i++) {
    game.tick();
    for (const event of game.state.events) {
      if (event.type !== 'shot') continue;
      const weaponId = (event as { weaponId?: string }).weaponId;
      if (!weaponId || event.entityId !== a.id) continue;
      if (shots.length === 0 || shots[shots.length - 1].weaponId !== weaponId) {
        shots.push({ tick: game.state.tick, weaponId });
      }
    }
  }
  return { game, shots };
}

describe('weapon selection', () => {
  it('uses the guided missile against a main battle tank', () => {
    const { shots } = duel('ifv', 'tank', 8);
    expect(shots[0]?.weaponId).toBe('atgm');
  });

  it('uses the autocannon against infantry', () => {
    const { shots } = duel('ifv', 'rifle', 4);
    expect(shots[0]?.weaponId).toBe('autocannon');
  });

  it('gives the Wilk and the CV90 their missile against heavy armour', () => {
    expect(duel('wilk', 'tank', 8).shots[0]?.weaponId).toBe('atgm');
    expect(duel('cv90', 'tank', 8).shots[0]?.weaponId).toBe('atgm');
  });

  it('does not let an out-of-range autocannon block the missile', () => {
    // The autocannon reaches 5.5 tiles; at 8 the only usable weapon is the ATGM.
    const { shots } = duel('ifv', 'tank', 9);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((shot) => shot.weaponId === 'atgm')).toBe(true);
  });

  it('falls back to the gun when the missile rack is empty', () => {
    const { shots } = duel('frigate', 'frigate', 6, { ammo: 0 });
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]?.weaponId).toBe('navalGun');
  });

  it('rejects a target inside the weapon minimum range', () => {
    const { shots } = duel('spg', 'tank', 2);
    expect(shots).toHaveLength(0);
  });

  it('rejects a target class the weapon cannot engage', () => {
    const { shots } = duel('aa', 'tank', 6);
    expect(shots).toHaveLength(0);
  });

  it('is deterministic for the same seed', () => {
    const first = duel('ifv', 'tank', 7, { seed: 12345 }).shots;
    const second = duel('ifv', 'tank', 7, { seed: 12345 }).shots;
    expect(second).toEqual(first);
  });
});

describe('weapon scoring', () => {
  it('scores the missile above the autocannon against heavy armour', () => {
    const missile = weaponScore(WEAPONS.atgm, 'heavy', 8);
    const gun = weaponScore(WEAPONS.autocannon, 'heavy', 8);
    expect(missile).toBeGreaterThan(gun);
  });

  it('scores the autocannon above the missile against infantry', () => {
    const missile = weaponScore(WEAPONS.atgm, 'infantry', 4);
    const gun = weaponScore(WEAPONS.autocannon, 'infantry', 4);
    expect(gun).toBeGreaterThan(missile);
  });

  it('keeps the earlier weapon on a tie', () => {
    const a = { weapon: WEAPONS.autocannon, score: 5 };
    const b = { weapon: WEAPONS.bofors40, score: 5 };
    expect(pickBestWeapon([a, b])?.id).toBe('autocannon');
    expect(pickBestWeapon([])).toBeNull();
  });
});
