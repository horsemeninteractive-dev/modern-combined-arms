import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createScenario, type Scenario } from '../src/sim/scenario';
import { TICK_RATE } from '../src/sim/constants';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { NATIONS, PLAYABLE_NATION_IDS, identityDef } from '../src/data/factions';
import {
  SUPERWEAPON_FAMILIES,
  SUPERWEAPON_IDS,
  superweaponPresentation,
} from '../src/data/superweapons';
import { TECHS, RESEARCH } from '../src/data/research';
import { researchOptionScore, type ResearchSignals } from '../src/sim/ai';
import { superweaponView } from '../src/ui/superweaponView';

/** A strategic arena: two commands, one exposed enemy base and open ground. */
function arena(
  nation = 'sweden',
  options: { superweapons?: boolean; fog?: boolean; centre?: boolean } = {},
): Scenario {
  const scenario = createScenario(32, 32, 'strategic arena');
  scenario.settings.startingMats = 9000;
  scenario.settings.startingReq = 1400;
  scenario.settings.fog = options.fog ?? false;
  if (options.superweapons === false) scenario.settings.superweapons = false;
  scenario.players = [
    { id: 0, name: 'Player', factionId: nation, team: 0, isAI: false, startX: 4, startZ: 4 },
    { id: 1, name: 'Opponent', factionId: 'russia', team: 1, isAI: false, startX: 28, startZ: 28 },
  ];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'powerPlant', owner: 0, x: 8, z: 2 },
    { defId: 'commandPost', owner: 1, x: 26, z: 26 },
    { defId: 'powerPlant', owner: 1, x: 22, z: 26 },
    { defId: 'factory', owner: 1, x: 20, z: 20 },
  );
  if (options.centre !== false) scenario.structures.push({ defId: 'strategicOps', owner: 0, x: 14, z: 2 });
  scenario.units.push(
    { defId: 'rifle', owner: 0, x: 6, z: 6 },
    { defId: 'rifle', owner: 0, x: 7, z: 6 },
    { defId: 'rifle', owner: 0, x: 6, z: 7 },
    { defId: 'rifle', owner: 1, x: 24, z: 18 },
    { defId: 'tank', owner: 1, x: 24, z: 20 },
    { defId: 'rifle', owner: 1, x: 23, z: 21 },
  );
  return scenario;
}

/** Arena with the centre and the nation's whole authority chain in hand. */
function readyGame(
  nation = 'sweden',
  options: { superweapons?: boolean; fog?: boolean; centre?: boolean } = {},
): Game {
  const game = new Game(arena(nation, options), { enableAI: false });
  const player = game.player(0)!;
  const family = game.superweaponFamilyFor(0);
  if (family) player.research.completed = [...player.research.completed, ...family.requires];
  return game;
}

function enemyFactory(game: Game) {
  return game
    .entitiesOf(1, 'building')
    .find((e) => e.kind === 'building' && e.defId === 'factory' && e.hp > 0)!;
}

function fire(game: Game, familyId: string, x: number, z: number, targetId = 0): void {
  game.enqueueCommand({
    type: 'superweapon',
    team: 0,
    familyId,
    x,
    z,
    ...(targetId ? { targetId } : {}),
  });
  game.tick();
}

describe('national superweapon configuration', () => {
  it('resolves only catalogue ids and leaves unspecialised nations intact', () => {
    for (const id of PLAYABLE_NATION_IDS) {
      const nation = NATIONS[id];
      if (nation.superweapon === undefined) continue;
      expect(SUPERWEAPON_IDS).toContain(nation.superweapon as never);
      expect(SUPERWEAPON_FAMILIES[nation.superweapon as never]).toBeDefined();
    }
  });

  it('gives both alliances exactly one nation per family', () => {
    for (const alliance of ['defender', 'eastern']) {
      const nations = PLAYABLE_NATION_IDS.map((id) => NATIONS[id]).filter(
        (nation) => nation.allianceId === alliance,
      );
      const families = nations.map((nation) => nation.superweapon).filter(Boolean);
      expect(new Set(families).size).toBe(families.length);
      expect([...families].sort()).toEqual([...SUPERWEAPON_IDS].sort());
    }
  });

  it('resolves a nation with no capability as a supported state', () => {
    // A legacy alliance force carries no national capability at all. It must
    // answer as a supported state rather than crash or offer a dead button.
    const stripped = arena('lithuania');
    stripped.players[0].factionId = 'baltic';
    const bare = new Game(stripped, { enableAI: false });
    expect(bare.superweaponFamilyFor(0)).toBeNull();
    expect(bare.superweaponStatus(0).reason).toContain('no strategic superweapon');
    expect(bare.superweaponStatus(0).ok).toBe(false);
  });

  it('reads presentation from the alliance, not the family alone', () => {
    const family = SUPERWEAPON_FAMILIES.hypersonic;
    expect(superweaponPresentation(family, 'eastern').name).toBe(family.easternName);
    expect(superweaponPresentation(family, 'defender').name).toBe(family.defenderName);
    expect(superweaponPresentation(family, undefined).name).toBe(family.defenderName);
    expect(NATIONS.sweden.superweapon).toBe('hypersonic');
    expect(NATIONS.russia.superweapon).toBe('hypersonic');
    expect(identityDef('sweden').id).toBe('sweden');
  });
});

describe('Strategic Operations Centre', () => {
  it('is a production structure gated by a command post and research centre', () => {
    const def = BUILDINGS.strategicOps;
    expect(def).toBeDefined();
    expect(buildingFamily('strategicOps')).toBe('strategicOps');
    expect(def.requires).toContain('commandPost');
    expect(def.requires).toContain('researchCentre');
    // It coordinates, it does not shoot.
    expect(def.weapons ?? []).toHaveLength(0);
    const game = readyGame();
    expect(game.availableBuildings(0)).toContain('strategicOps');
  });

  it('blocks activation while no centre stands', () => {
    const game = readyGame('sweden', { centre: false });
    const status = game.superweaponStatus(0);
    expect(status.hasCentre).toBe(false);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('Strategic Operations Centre');
  });

  it('stops new authorisations when destroyed and never resets the reload', () => {
    const game = readyGame();
    const centre = game.strategicOpsCentre(0)!;
    const player = game.player(0)!;
    player.superweapon.cooldowns.hypersonic = game.state.tick + TICK_RATE * 120;
    centre.hp = 0;
    expect(game.superweaponStatus(0).hasCentre).toBe(false);
    expect(game.superweaponStatus(0).ok).toBe(false);
    // Rebuilding is the same entity returning to service: the national reload
    // is per-commander state, so it is untouched.
    centre.hp = centre.maxHp;
    expect(game.superweaponStatus(0).hasCentre).toBe(true);
    expect(game.superweaponStatus(0).cooldown).toBeGreaterThan(100);
    expect(game.superweaponStatus(0).ok).toBe(false);
  });
});

describe('research authority chain', () => {
  it('requires all four technologies, not any four researches', () => {
    const game = new Game(arena(), { enableAI: false });
    const family = game.superweaponFamilyFor(0)!;
    const player = game.player(0)!;
    const [first, second, third, fourth] = family.requires;
    player.research.completed = [...player.research.completed, first, second, third];
    const status = game.superweaponStatus(0);
    expect(status.missingTechs).toHaveLength(1);
    expect(status.missingTechs[0].id).toBe(fourth);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain(TECHS[fourth].name);
    player.research.completed = [...player.research.completed, fourth];
    expect(game.superweaponStatus(0).ok).toBe(true);
  });

  it('is not satisfied by unrelated technologies', () => {
    const game = new Game(arena(), { enableAI: false });
    const family = game.superweaponFamilyFor(0)!;
    const player = game.player(0)!;
    const unrelated = RESEARCH.techs
      .map((tech) => tech.id)
      .filter((id) => !family.requires.includes(id));
    player.research.completed = unrelated;
    expect(game.superweaponStatus(0).missingTechs).toHaveLength(4);
    expect(game.superweaponStatus(0).ok).toBe(false);
  });

  it('gives the prerequisite nodes real weight in the AI research planner', () => {
    const tech = TECHS.hypersonicGlide;
    expect(tech).toBeDefined();
    const signals: ResearchSignals = {
      seed: 1337,
      tick: 0,
      timeLimitSec: null,
      completed: [...tech.requires],
      unitCounts: new Map(),
      buildingCounts: new Map(),
      rosterUnits: new Set(['tank']),
      exclusiveTechs: new Set(),
      profile: { tech: 0.6 } as ResearchSignals['profile'],
      strategy: 'armour',
      mix: { armour: 4, infantry: 4 },
      enemyAir: 0,
      enemyNaval: 0,
      fortified: 1,
      hasWater: false,
      superweaponTechs: ['fires2', 'air2', 'hypersonicGlide', 'terminalSeeker'],
    };
    const option = researchOptionScore(tech, signals);
    expect(option.score).toBeGreaterThan(0);
    expect(option.reason).toContain('strategic authority');
    // Without the authority chain in the signal the node publishes no unlock of
    // its own, so it is worth nothing to a commander that cannot use it.
    const without = researchOptionScore(tech, { ...signals, superweaponTechs: [] });
    expect(without.score).toBe(0);
  });
});

describe('activation', () => {
  it('charges the cost once and starts both the operation and the reload', () => {
    const game = readyGame();
    const player = game.player(0)!;
    const family = game.superweaponFamilyFor(0)!;
    const before = { mats: player.mats, req: player.req };
    const target = enemyFactory(game);
    fire(game, family.id, target.x, target.z, target.id);
    // A command post trickles a fraction of a material per tick, so the charge
    // is exact to within the income of the single processed tick.
    expect(player.mats).toBeCloseTo(before.mats - family.cost.mats, 0);
    expect(player.req).toBeCloseTo(before.req - family.cost.req, 0);
    const operation = game.superweaponOperation(0)!;
    expect(operation.family).toBe(family.id);
    expect(operation.phase).toBe('warning');
    expect(operation.executeTick - operation.startTick).toBe(
      Math.round(family.warningSeconds * TICK_RATE),
    );
    expect(game.superweaponStatus(0).cooldown).toBeCloseTo(family.cooldownSeconds, 5);
  });

  it('refuses an unaffordable call-in without charging or committing', () => {
    const game = readyGame();
    const player = game.player(0)!;
    player.mats = 0;
    player.req = 0;
    const target = enemyFactory(game);
    fire(game, 'hypersonic', target.x, target.z, target.id);
    expect(game.superweaponOperation(0)).toBeNull();
    expect(player.mats).toBeLessThan(1);
    expect(game.player(0)!.superweapon.cooldowns.hypersonic ?? 0).toBe(0);
    expect(game.superweaponStatus(0).reason).toContain('Not enough resources');
  });

  it('rejects an invalid target without spending anything', () => {
    const game = readyGame();
    const player = game.player(0)!;
    const before = { mats: player.mats, req: player.req };
    // A precision strike needs a structure, and a point on the ground is not one.
    fire(game, 'hypersonic', 20 * 32, 20 * 32, 0);
    expect(game.superweaponOperation(0)).toBeNull();
    expect(player.mats).toBeCloseTo(before.mats, 0);
    expect(player.req).toBeLessThan(before.req + 1);
    // A friendly structure is not a valid precision target either.
    const own = game
      .entitiesOf(0, 'building')
      .find((e) => e.kind === 'building' && e.hp > 0)!;
    fire(game, 'hypersonic', own.x, own.z, own.id);
    expect(game.superweaponOperation(0)).toBeNull();
    expect(player.mats).toBeCloseTo(before.mats, 0);
    expect(game.superweaponStatus(0).cooldown).toBe(0);
  });

  it('rejects an area the commander cannot see', () => {
    const game = readyGame('uk', { fog: true });
    const player = game.player(0)!;
    const before = player.mats;
    fire(game, 'saturation', 28 * 32, 28 * 32, 0);
    expect(game.superweaponOperation(0)).toBeNull();
    expect(player.mats).toBeCloseTo(before, 0);
  });

  it('cannot be bought twice by a replayed command', () => {
    const game = readyGame();
    const player = game.player(0)!;
    const family = game.superweaponFamilyFor(0)!;
    const target = enemyFactory(game);
    const before = player.mats;
    game.enqueueCommand({
      type: 'superweapon',
      team: 0,
      familyId: family.id,
      x: target.x,
      z: target.z,
      targetId: target.id,
    });
    game.enqueueCommand({
      type: 'superweapon',
      team: 0,
      familyId: family.id,
      x: target.x,
      z: target.z,
      targetId: target.id,
    });
    game.tick();
    expect(player.mats).toBeCloseTo(before - family.cost.mats, 0);
    expect(game.superweaponOperation(0)).not.toBeNull();
  });

  it('blocks a second operation while the reload runs', () => {
    const game = readyGame();
    const player = game.player(0)!;
    const target = enemyFactory(game);
    fire(game, 'hypersonic', target.x, target.z, target.id);
    game.advance(TICK_RATE * 30);
    expect(game.superweaponOperation(0)).toBeNull();
    const before = player.mats;
    fire(game, 'hypersonic', target.x, target.z, target.id);
    expect(game.superweaponOperation(0)).toBeNull();
    expect(player.mats).toBeLessThan(before + 1);
    expect(game.superweaponStatus(0).reason).toContain('National reload');
  });

  it('gives every family its own targeting mode', () => {
    expect(SUPERWEAPON_FAMILIES.hypersonic.targeting).toBe('enemyStructure');
    expect(SUPERWEAPON_FAMILIES.saturation.targeting).toBe('enemyArea');
    expect(SUPERWEAPON_FAMILIES.ew.targeting).toBe('enemyNetwork');
    expect(SUPERWEAPON_FAMILIES.drone.targeting).toBe('enemyArea');
    expect(SUPERWEAPON_FAMILIES.dew.targeting).toBe('friendlyArea');
  });
});

describe('effects', () => {
  it('resolves a hypersonic strike as one damaged structure', () => {
    const game = readyGame('sweden');
    const target = enemyFactory(game);
    const beforeHp = target.hp;
    fire(game, 'hypersonic', target.x, target.z, target.id);
    // The warning is the response window; one tick later the round is in flight.
    game.advance(Math.round(SUPERWEAPON_FAMILIES.hypersonic.warningSeconds * TICK_RATE) + 1);
    expect(
      game.state.projectiles.some((p) => p.strategic?.family === 'hypersonic') ||
        target.hp < beforeHp,
    ).toBe(true);
    game.advance(TICK_RATE * 30);
    expect(target.hp).toBeLessThan(beforeHp);
    expect(game.superweaponOperation(0)).toBeNull();
  });

  it('spreads a saturation barrage over several seconds', () => {
    const game = readyGame('uk');
    const family = game.superweaponFamilyFor(0)!;
    const target = enemyFactory(game);
    fire(game, family.id, target.x, target.z);
    game.advance(Math.round(family.warningSeconds * TICK_RATE) + 1);
    const first = game.superweaponOperation(0)?.launched ?? 0;
    game.advance(TICK_RATE);
    const later = game.superweaponOperation(0)?.launched ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(first);
    if (family.effect.kind === 'saturation') {
      expect(later).toBeLessThanOrEqual(family.effect.munitions);
    }
  });

  it('degrades the sensor picture of a hostile commander in the area', () => {
    const game = readyGame('lithuania');
    const family = game.superweaponFamilyFor(0)!;
    const target = enemyFactory(game);
    fire(game, family.id, target.x, target.z);
    game.advance(Math.round(family.warningSeconds * TICK_RATE) + 1);
    expect(game.superweaponStatus(1).ewActive).toBe(true);
    expect(game.superweaponStatus(0).ewActive).toBe(false);
    if (family.effect.kind === 'ew') {
      game.advance(TICK_RATE * (family.effect.durationSeconds + 2));
      expect(game.superweaponStatus(1).ewActive).toBe(false);
    }
  });

  it('establishes a defensive field for the commander that fired it', () => {
    const game = readyGame('finland');
    const family = game.superweaponFamilyFor(0)!;
    const own = game
      .entitiesOf(0, 'unit')
      .find((e) => e.kind === 'unit' && e.hp > 0)!;
    fire(game, family.id, own.x, own.z);
    game.advance(Math.round(family.warningSeconds * TICK_RATE) + 1);
    expect(game.superweaponStatus(0).defenceActive).toBe(true);
    if (family.effect.kind === 'dew') {
      game.advance(TICK_RATE * (family.effect.durationSeconds + 2));
      expect(game.superweaponStatus(0).defenceActive).toBe(false);
    }
  });

  it('exists only where the battle permits it', () => {
    const game = readyGame('sweden', { superweapons: false });
    const status = game.superweaponStatus(0);
    expect(status.enabled).toBe(false);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('disabled');
    const target = enemyFactory(game);
    fire(game, 'hypersonic', target.x, target.z, target.id);
    expect(game.superweaponOperation(0)).toBeNull();
    // Construction and research are untouched by the rule: only the call-in
    // itself is refused, exactly as a mission that withholds it intends.
    expect(game.availableBuildings(0)).toContain('strategicOps');
  });

  it('survives a save and load with its reload intact', () => {
    const game = readyGame();
    const family = game.superweaponFamilyFor(0)!;
    const target = enemyFactory(game);
    fire(game, family.id, target.x, target.z, target.id);
    const saved = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(saved, { enableAI: false });
    expect(restored.superweaponOperation(0)?.family).toBe(family.id);
    expect(restored.superweaponStatus(0).cooldown).toBeCloseTo(
      game.superweaponStatus(0).cooldown,
      5,
    );
  });
});

describe('panel wording', () => {
  it('explains the first unmet gate and never offers an illegal button', () => {
    const plain = readyGame('sweden', { centre: false });
    const view = superweaponView(plain.superweaponStatus(0), null);
    expect(view.tone).toBe('locked');
    expect(view.canFire).toBe(false);
    expect(view.detail).toContain('Strategic Operations Centre');

    const ready = readyGame('sweden');
    const readyView = superweaponView(ready.superweaponStatus(0), null);
    expect(readyView.tone).toBe('ready');
    expect(readyView.canFire).toBe(true);
    expect(readyView.requirements.every((row) => row.ready)).toBe(true);

    const off = readyGame('sweden', { superweapons: false });
    expect(superweaponView(off.superweaponStatus(0), null).tone).toBe('unavailable');
  });
});
