import { describe, expect, it } from 'vitest';
import {
  RESEARCH,
  RESEARCH_BRANCHES,
  TECHS,
  TIER_ZERO_BUILDINGS,
  TIER_ZERO_UNITS,
  exclusiveUnitTech,
  validateResearchCatalog,
  type ResearchCatalog,
  type TechDef,
} from '../src/data/research';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { NATIONS } from '../src/data/factions';
import { resolveRoster } from '../src/data/roster';
import { unitFamily } from '../src/data/units';
import { createScenario, validateScenario, type Scenario } from '../src/sim/scenario';
import { Game } from '../src/sim/game';
import { TICK_RATE } from '../src/sim/constants';

function arena(nation = 'lithuania'): Scenario {
  const scenario = createScenario(32, 32, 'research arena');
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 800;
  scenario.settings.fog = false;
  scenario.players = [
    { id: 0, name: 'Player', factionId: nation, team: 0, isAI: false, startX: 4, startZ: 4 },
    { id: 1, name: 'Opponent', factionId: 'russia', team: 1, isAI: false, startX: 28, startZ: 28 },
  ];
  const centre = nation === 'belarus' ? 'signalsBureau' : 'researchCentre';
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: centre, owner: 0, x: 8, z: 2 },
    { defId: 'factory', owner: 0, x: 14, z: 14 },
    { defId: 'powerPlant', owner: 0, x: 20, z: 2 },
    { defId: 'powerPlant', owner: 0, x: 24, z: 2 },
    { defId: 'commandPost', owner: 1, x: 26, z: 26 },
    { defId: 'powerPlant', owner: 1, x: 22, z: 26 },
  );
  scenario.units.push(
    { defId: 'recon', owner: 0, x: 6, z: 10 },
    { defId: 'rifle', owner: 0, x: 8, z: 12 },
    { defId: 'rifle', owner: 1, x: 24, z: 18 },
  );
  return scenario;
}

function centreOf(game: Game, owner = 0) {
  return game.state.entities.find(
    (e) =>
      e.owner === owner &&
      e.kind === 'building' &&
      buildingFamily(e.defId) === 'researchCentre',
  )!;
}

function unitOf(game: Game, defId: string, owner = 0) {
  return game.state.entities.find(
    (e) => e.owner === owner && e.kind === 'unit' && e.defId === defId,
  )!;
}

function plantOf(game: Game, index = 0) {
  return game.state.entities.filter(
    (e) => e.owner === 0 && e.defId === 'powerPlant',
  )[index];
}

const TEST_TECH: TechDef = {
  id: 'testDoctrine',
  name: 'Test Doctrine',
  easternName: 'Test Doctrine',
  branch: 'manoeuvre',
  tier: 1,
  cost: { mats: 100, req: 20 },
  seconds: 2,
  requires: [],
  effects: [
    { kind: 'grantUnitUpgrade', upgrade: 'reconSmokescreen' },
    { kind: 'grantBuildingModule', module: 'advancedTurbine' },
  ],
  description: 'Fixture technology used to exercise the upgrade and module paths.',
  icon: 'research',
};

const RESTRICTED_TECH: TechDef = {
  ...TEST_TECH,
  id: 'easternOnly',
  name: 'Eastern Only',
  alliances: ['eastern'],
};

const NATION_TECH: TechDef = {
  ...TEST_TECH,
  id: 'polishOnly',
  name: 'Polish Only',
  nations: ['poland'],
};

function fixtureCatalog(extra: TechDef[] = [TEST_TECH]): ResearchCatalog {
  return {
    techs: [...RESEARCH.techs, ...extra],
    upgrades: RESEARCH.upgrades,
    modules: RESEARCH.modules,
  };
}

function researchedGame(catalog = fixtureCatalog()): Game {
  const game = new Game(arena(), { enableAI: false, research: catalog });
  return game;
}

function startTestResearch(game: Game): void {
  game.enqueueCommand({
    type: 'research',
    team: 0,
    buildingId: centreOf(game).id,
    techId: 'testDoctrine',
  });
  game.advance(TICK_RATE * 2);
}

describe('research definitions', () => {
  it('ships the four approved branches with two tiers each', () => {
    expect(RESEARCH.techs).toHaveLength(8);
    for (const branch of RESEARCH_BRANCHES) {
      const nodes = RESEARCH.techs.filter((tech) => tech.branch === branch);
      expect(nodes.map((tech) => tech.tier).sort()).toEqual([1, 2]);
    }
  });

  it('makes tier 2 depend only on its own tier 1 and nothing cross-branch', () => {
    for (const tech of RESEARCH.techs.filter((entry) => entry.tier === 2)) {
      expect(tech.requires).toHaveLength(1);
      const prerequisite = TECHS[tech.requires[0]];
      expect(prerequisite.branch).toBe(tech.branch);
      expect(prerequisite.tier).toBe(1);
    }
    expect(RESEARCH.techs.filter((tech) => tech.tier === 1).every((tech) => tech.requires.length === 0)).toBe(true);
  });

  it('validates the shipped catalogue without issues and resolves every effect', () => {
    expect(validateResearchCatalog()).toEqual([]);
    for (const tech of RESEARCH.techs) {
      expect(tech.effects.length, tech.id).toBeGreaterThan(0);
      for (const effect of tech.effects) {
        if (effect.kind === 'unlockUnit') expect(unitFamily(effect.slot)).toBe(effect.slot);
        if (effect.kind === 'unlockBuilding') expect(buildingFamily(effect.slot)).toBe(effect.slot);
      }
    }
  });

  it('leaves no canonical platform or buildable structure without an unlock path', () => {
    const units = new Set<string>([
      ...TIER_ZERO_UNITS,
      ...RESEARCH.techs.flatMap((tech) =>
        tech.effects.flatMap((effect) => (effect.kind === 'unlockUnit' ? [effect.slot] : [])),
      ),
    ]);
    const canon = new Set(
      resolveRoster('lithuania')
        .units.filter((id) => exclusiveUnitTech(id) === undefined)
        .map((id) => unitFamily(id)),
    );
    for (const slot of canon) expect(units.has(slot), `unit slot ${slot}`).toBe(true);

    const buildings = new Set<string>([
      ...TIER_ZERO_BUILDINGS,
      ...RESEARCH.techs.flatMap((tech) =>
        tech.effects.flatMap((effect) =>
          effect.kind === 'unlockBuilding' ? [effect.slot] : [],
        ),
      ),
    ]);
    for (const def of Object.values(BUILDINGS)) {
      if (def.authoredOnly) continue;
      // A national variant inherits its canonical slot's unlock.
      expect(buildings.has(buildingFamily(def.id)), `structure ${def.id}`).toBe(true);
    }
  });

  it('keeps the approved tier-0 roster and ties national exclusives to their branch', () => {
    const game = new Game(arena('belarus'), { enableAI: false });
    const units = game.availableUnits(0);
    expect(units).toContain('sprut');
    // Belarus fields the Eastern rifle and IFV platforms; their canonical
    // families are tier 0, so the query returns the platform, not the slot id.
    expect(units.some((id) => unitFamily(id) === 'rifle')).toBe(true);
    expect(units.some((id) => unitFamily(id) === 'tank')).toBe(false);
    expect(units.some((id) => unitFamily(id) === 'td')).toBe(false);
    expect(game.availableBuildings(0)).toContain('signalsBureau');
    expect(game.availableBuildings(0)).toContain('samBattery');
    expect(game.availableBuildings(0)).toContain('coastalBattery');
    expect(game.availableBuildings(0)).not.toContain('airfield');
  });

  it('reports invalid references, cycles and duplicate ids', () => {
    const broken: ResearchCatalog = {
      techs: [
        { ...TEST_TECH, id: 'a', requires: ['b'] },
        { ...TEST_TECH, id: 'b', requires: ['a'] },
        { ...TEST_TECH, id: 'b', effects: [{ kind: 'unlockUnit', slot: 'notAUnit' }] },
        {
          ...TEST_TECH,
          id: 'c',
          effects: [{ kind: 'grantUnitUpgrade', upgrade: 'missing' }],
        },
      ],
      upgrades: RESEARCH.upgrades,
      modules: RESEARCH.modules,
    };
    const codes = validateResearchCatalog(broken).map((issue) => issue.code);
    expect(codes).toContain('duplicate-tech');
    expect(codes).toContain('cycle');
    expect(codes).toContain('missing-unit');
    expect(codes).toContain('missing-upgrade');
  });

  it('reports two technologies claiming the same unlock', () => {
    const broken: ResearchCatalog = {
      techs: [
        { ...TEST_TECH, id: 'one', effects: [{ kind: 'unlockUnit', slot: 'tank' }] },
        { ...TEST_TECH, id: 'two', effects: [{ kind: 'unlockUnit', slot: 'tank' }] },
      ],
      upgrades: RESEARCH.upgrades,
      modules: RESEARCH.modules,
    };
    expect(validateResearchCatalog(broken).map((issue) => issue.code)).toContain('duplicate-unlock');
  });
});

describe('authoritative research progression', () => {
  it('spends once, starts once and completes on the fixed tick', () => {
    const game = new Game(arena(), { enableAI: false });
    const p = game.player(0)!;
    const centre = centreOf(game);
    const before = { mats: p.mats, req: p.req };
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.tick();
    expect(p.research.project).toMatchObject({ techId: 'manoeuvre1', total: 45 });
    // The headquarters' backstop trickle adds a fraction of a material per tick.
    expect(p.mats).toBeGreaterThan(before.mats - 300.2);
    expect(p.mats).toBeLessThan(before.mats - 299.8);
    expect(p.req).toBeGreaterThan(before.req - 40.2);
    expect(p.req).toBeLessThan(before.req - 39.8);

    game.advance(898);
    expect(p.research.completed).toEqual([]);
    expect(p.research.project!.remaining).toBeGreaterThan(0);
    game.advance(1);
    expect(p.research.completed).toEqual(['manoeuvre1']);
    expect(p.research.project).toBeNull();
    expect(game.unitSlotUnlocked(0, 'tank')).toBe(true);
    expect(game.unitSlotUnlocked(0, 'ifv')).toBe(true);
    expect(game.unitSlotUnlocked(0, 'td')).toBe(false);

    const after = { mats: p.mats, req: p.req };
    game.advance(200);
    expect(p.research.completed).toEqual(['manoeuvre1']);
    expect(p.mats).toBeGreaterThanOrEqual(after.mats);
    expect(p.mats).toBeLessThan(after.mats + 11);
    expect(p.req).toBeGreaterThanOrEqual(after.req);
    expect(p.req).toBeLessThan(after.req + 5);
  });

  it('refuses unaffordable, prereq-locked and duplicate projects without spending', () => {
    const game = new Game(arena(), { enableAI: false });
    const p = game.player(0)!;
    const centre = centreOf(game);
    const mats = p.mats;

    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre2' });
    game.tick();
    expect(p.research.project).toBeNull();
    expect(p.mats).toBeGreaterThanOrEqual(mats);

    p.mats = 0;
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.tick();
    expect(p.research.project).toBeNull();
    expect(p.mats).toBeLessThan(1);

    p.mats = 5000;
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.tick();
    const paid = p.mats;
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.tick();
    expect(p.mats - paid).toBeLessThan(0.2);
    expect(p.research.project!.techId).toBe('manoeuvre1');
  });

  it('enforces alliance eligibility authoritatively', () => {
    const game = researchedGame(fixtureCatalog([TEST_TECH, RESTRICTED_TECH]));
    const p = game.player(0)!;
    const status = game.researchStatus(0, centreOf(game).id, 'easternOnly');
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/alliance/);
    expect(p.research.project).toBeNull();
  });

  it('enforces nation eligibility authoritatively', () => {
    const game = researchedGame(fixtureCatalog([TEST_TECH, NATION_TECH]));
    const status = game.researchStatus(0, centreOf(game).id, 'polishOnly');
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/nation/);
    expect(game.player(0)!.research.project).toBeNull();
  });

  it('pauses while the centre is unavailable and resumes at the same progress', () => {
    const game = new Game(arena(), { enableAI: false });
    const p = game.player(0)!;
    const centre = centreOf(game);
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.advance(100);
    const remaining = p.research.project!.remaining;
    // Ownership stands in for any non-operational state that leaves the
    // building standing: no owned centre means no progress.
    centre.owner = 1;
    game.advance(200);
    expect(p.research.project!.remaining).toBeCloseTo(remaining, 6);
    centre.owner = 0;
    game.advance(100);
    expect(p.research.project!.remaining).toBeLessThan(remaining);
  });

  it('refunds the project cost on cancellation', () => {
    const game = new Game(arena(), { enableAI: false });
    const p = game.player(0)!;
    const centre = centreOf(game);
    game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
    game.advance(50);
    const paid = p.mats;
    game.enqueueCommand({ type: 'cancelResearch', team: 0, buildingId: centre.id });
    game.tick();
    expect(p.research.project).toBeNull();
    expect(p.mats - paid).toBeGreaterThan(299.8);
    expect(p.mats - paid).toBeLessThan(300.2);
  });

  it('allows only one Research Centre per battlegroup', () => {
    const game = new Game(arena(), { enableAI: false });
    const status = game.placementStatus(0, 'researchCentre', 8, 8);
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/one Research Centre/i);
  });
});

describe('research units, upgrades and modules', () => {
  it('makes a researched upgrade available to existing eligible units without applying it', () => {
    const game = researchedGame();
    const recon = unitOf(game, 'recon');
    const rifle = unitOf(game, 'rifle');
    expect(game.availableUpgrades(0, recon.id)).toEqual([]);

    startTestResearch(game);
    expect(game.completedTechnologies(0)).toContain('testDoctrine');
    expect(game.availableUpgrades(0, recon.id).map((upgrade) => upgrade.id)).toEqual([
      'reconSmokescreen',
    ]);
    expect(game.availableUpgrades(0, rifle.id)).toEqual([]);
    // Unlocked is not applied.
    expect(game.appliedUpgrades(recon.id)).toEqual([]);

    game.enqueueCommand({ type: 'activateUpgrade', team: 0, unitId: recon.id, upgradeId: 'reconSmokescreen' });
    game.tick();
    expect(game.appliedUpgrades(recon.id)).toEqual(['reconSmokescreen']);
    expect(game.availableUpgrades(0, recon.id)).toEqual([]);
  });

  it('resolves national replacements and exclusives without cross-nation leakage', () => {
    const pole = arena('poland');
    pole.players[0].technologies = ['manoeuvre1'];
    const game = new Game(pole, { enableAI: false });
    const units = game.availableUnits(0);
    // The Spearhead inherits the tank slot; Wilk needs the tier-2 node.
    expect(units).toContain('spearhead');
    expect(units).not.toContain('tank');
    expect(units).not.toContain('wilk');
    expect(units).not.toContain('kestrelTeam');
    expect(units).not.toContain('sprut');
    expect(game.unitDefinitionUnlocked(0, 'wilk')).toBe(false);
    game.player(0)!.research.completed.push('manoeuvre2');
    expect(game.unitDefinitionUnlocked(0, 'wilk')).toBe(true);
  });

  it('gives a newly produced eligible unit the same availability', () => {
    const game = researchedGame();
    startTestResearch(game);
    const factory = game.state.entities.find((e) => e.owner === 0 && e.defId === 'factory')!;
    const before = new Set(game.state.entities.map((e) => e.id));
    // Lithuania fields the Pathfinder in the recon slot; the upgrade follows
    // the canonical slot, not the platform id.
    const reconId = game.unitIdFor(0, 'recon')!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: reconId });
    game.advance(TICK_RATE * 60);
    const produced = game.state.entities.find(
      (e) => e.owner === 0 && e.defId === reconId && !before.has(e.id),
    )!;
    expect(produced).toBeDefined();
    expect(game.availableUpgrades(0, produced.id).map((upgrade) => upgrade.id)).toEqual([
      'reconSmokescreen',
    ]);
  });

  it('makes a researched module available per structure and installs it individually', () => {
    const game = researchedGame();
    const first = plantOf(game, 0);
    const second = plantOf(game, 1);
    expect(game.availableModules(0, first.id)).toEqual([]);

    startTestResearch(game);
    expect(game.availableModules(0, first.id).map((module) => module.id)).toEqual([
      'advancedTurbine',
    ]);
    expect(game.availableModules(0, second.id).map((module) => module.id)).toEqual([
      'advancedTurbine',
    ]);
    // Research availability is not installation.
    expect(first.modules ?? []).toEqual([]);
    expect(second.modules ?? []).toEqual([]);

    const p = game.player(0)!;
    const before = p.mats;
    const supplyBefore = game.powerStatus(0).supply;
    game.enqueueCommand({ type: 'installModule', team: 0, buildingId: first.id, moduleId: 'advancedTurbine' });
    game.tick();
    expect(game.installedModules(first.id)).toEqual(['advancedTurbine']);
    expect(game.installedModules(second.id)).toEqual([]);
    expect(before - p.mats).toBeGreaterThan(449.8);
    expect(before - p.mats).toBeLessThan(450.2);
    // The fitted module changes the structure's grid contribution, not just
    // its stored id list.
    expect(game.powerStatus(0).supply).toBe(supplyBefore + 30);

    const paid = p.mats;
    game.enqueueCommand({ type: 'installModule', team: 0, buildingId: first.id, moduleId: 'advancedTurbine' });
    game.tick();
    expect(p.mats - paid).toBeLessThan(0.2);
    expect(game.installedModules(first.id)).toEqual(['advancedTurbine']);
  });

  it('gives a structure completed after the research the same module access', () => {
    const scenario = arena();
    scenario.units.push({ defId: 'engineer', owner: 0, x: 13, z: 12 });
    const game = new Game(scenario, { enableAI: false, research: fixtureCatalog() });
    startTestResearch(game);
    let site: { x: number; z: number } | null = null;
    for (let z = 4; z < 26 && !site; z++) {
      for (let x = 8; x < 28; x++) {
        if (game.placementStatus(0, 'powerPlant', x, z).ok) {
          site = { x, z };
          break;
        }
      }
    }
    expect(site).not.toBeNull();
    const before = new Set(
      game.entitiesOf(0, 'building').filter((e) => e.defId === 'powerPlant').map((e) => e.id),
    );
    game.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      defId: 'powerPlant',
      tileX: site!.x,
      tileZ: site!.z,
    });
    game.advance(TICK_RATE * 90);
    const built = game
      .entitiesOf(0, 'building')
      .find((e) => e.defId === 'powerPlant' && !e.construction && !before.has(e.id));
    expect(built).toBeDefined();
    expect(game.availableModules(0, built!.id).map((module) => module.id)).toContain(
      'advancedTurbine',
    );
  });

  it('rejects a module on an ineligible or unowned structure', () => {
    const game = researchedGame();
    startTestResearch(game);
    const centre = centreOf(game);
    const enemyPlant = game.state.entities.find(
      (e) => e.owner === 1 && e.defId === 'powerPlant',
    )!;
    expect(game.moduleStatus(0, centre.id, 'advancedTurbine').ok).toBe(false);
    expect(game.moduleStatus(0, enemyPlant.id, 'advancedTurbine').ok).toBe(false);
  });

  it('round-trips research, installed modules and applied upgrades through a save', () => {
    const catalog = fixtureCatalog();
    const game = new Game(arena(), { enableAI: false, research: catalog });
    startTestResearch(game);
    const recon = unitOf(game, 'recon');
    const plant = plantOf(game, 0);
    game.enqueueCommand({ type: 'activateUpgrade', team: 0, unitId: recon.id, upgradeId: 'reconSmokescreen' });
    game.enqueueCommand({ type: 'installModule', team: 0, buildingId: plant.id, moduleId: 'advancedTurbine' });
    // Leave a second project in progress so the save has to carry both a
    // completed record and a partial one.
    game.enqueueCommand({
      type: 'research',
      team: 0,
      buildingId: centreOf(game).id,
      techId: 'manoeuvre1',
    });
    game.advance(3);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false, research: catalog });
    expect(restored.stateHash()).toBe(game.stateHash());
    expect(restored.completedTechnologies(0)).toEqual(['testDoctrine']);
    expect(restored.player(0)!.research.project!.techId).toBe('manoeuvre1');
    expect(restored.player(0)!.research.project!.remaining).toBeCloseTo(
      game.player(0)!.research.project!.remaining,
      6,
    );
    expect(restored.installedModules(plant.id)).toEqual(['advancedTurbine']);
    expect(restored.appliedUpgrades(recon.id)).toEqual(['reconSmokescreen']);
    game.advance(100);
    restored.advance(100);
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('drops installed modules and upgrades that are illegal for the entity', () => {
    const catalog = fixtureCatalog();
    const game = new Game(arena(), { enableAI: false, research: catalog });
    startTestResearch(game);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const factory = save.state.entities.find(
      (e: { defId: string; owner: number }) => e.owner === 0 && e.defId === 'factory',
    );
    const rifle = save.state.entities.find(
      (e: { defId: string; owner: number }) => e.owner === 0 && e.defId === 'rifle',
    );
    const plant = save.state.entities.find(
      (e: { defId: string; owner: number }) => e.owner === 0 && e.defId === 'powerPlant',
    );
    factory.modules = ['advancedTurbine'];
    rifle.upgrades = ['reconSmokescreen'];
    plant.modules = ['advancedTurbine'];
    const restored = Game.fromSave(save, { enableAI: false, research: catalog });
    expect(restored.installedModules(factory.id)).toEqual([]);
    expect(restored.appliedUpgrades(rifle.id)).toEqual([]);
    expect(restored.installedModules(plant.id)).toEqual(['advancedTurbine']);
  });

  it('drops completed or in-progress research whose prerequisites are absent', () => {
    const game = new Game(arena(), { enableAI: false });
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.state.players[0].research = {
      completed: ['manoeuvre2'],
      project: { techId: 'naval2', remaining: 20, total: 90 },
    };
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.completedTechnologies(0)).toEqual([]);
    expect(restored.player(0)!.research.project).toBeNull();
  });

  it('initialises empty research on a save written before research existed', () => {
    const game = new Game(arena(), { enableAI: false });
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.version = 2;
    for (const player of save.state.players) delete player.research;
    for (const entity of save.state.entities) {
      delete entity.upgrades;
      delete entity.modules;
    }
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.player(0)!.research).toEqual({ completed: [], project: null });
    expect(restored.state.entities.every((e) => !e.upgrades && !e.modules)).toBe(true);
  });

  it('grants scenario technologies and the technologies implied by pre-placed content', () => {
    const scenario = arena();
    scenario.players[0].technologies = ['fires1'];
    scenario.structures.push({ defId: 'airfield', owner: 0, x: 22, z: 10 });
    const game = new Game(scenario, { enableAI: false });
    expect(game.completedTechnologies(0)).toContain('fires1');
    expect(game.completedTechnologies(0)).toContain('air1');
    expect(game.unitSlotUnlocked(0, 'spg')).toBe(true);
    expect(game.unitSlotUnlocked(0, 'tank')).toBe(false);
    expect(game.buildingSlotUnlocked(0, 'airfield')).toBe(true);
  });

  it('validates scenario-granted technology ids instead of silently dropping them', () => {
    const scenario = arena();
    scenario.players[0].technologies = ['notATechnology'];
    const issues = validateScenario(scenario);
    expect(issues.some((issue) => issue.code === 'unknown-technology')).toBe(true);
  });
});

describe('Research Centre and national variant', () => {
  it('resolves the Belarusian bureau through the Research Centre slot and keeps it Belarus-only', () => {
    expect(BUILDINGS.signalsBureau.variantOf).toBe('researchCentre');
    expect(buildingFamily('signalsBureau')).toBe('researchCentre');
    expect(resolveRoster('belarus').buildings).toContain('signalsBureau');
    for (const id of ['lithuania', 'poland', 'uk', 'russia', 'hungary']) {
      expect(resolveRoster(id).buildings, id).not.toContain('signalsBureau');
      expect(resolveRoster(id).buildings, id).toContain('researchCentre');
    }
    expect(NATIONS.belarus.roster?.replaceBuildings?.researchCentre).toBe('signalsBureau');
  });

  it('runs the same authoritative project on both centre variants, faster for Belarus', () => {
    const standard = new Game(arena(), { enableAI: false });
    const belarus = new Game(arena('belarus'), { enableAI: false });
    for (const [game, expected] of [
      [standard, 45],
      [belarus, 36],
    ] as const) {
      const centre = centreOf(game);
      expect(buildingFamily(centre.defId)).toBe('researchCentre');
      game.enqueueCommand({ type: 'research', team: 0, buildingId: centre.id, techId: 'manoeuvre1' });
      game.advance(TICK_RATE * expected);
      expect(game.completedTechnologies(0), centre.defId).toContain('manoeuvre1');
    }
  });
});
