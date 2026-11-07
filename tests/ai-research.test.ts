import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import {
  AIController,
  RESEARCH_MIN_SCORE,
  aiProfile,
  initialAIState,
  researchOptionScore,
  type ResearchSignals,
} from '../src/sim/ai';
import { RESEARCH, techDef, type ResearchCatalog, type TechDef } from '../src/data/research';
import type { AIDifficulty } from '../src/sim/types';
import type { Scenario } from '../src/sim/scenario';

type Spawn = { defId: string; x: number; z: number };

interface ArenaOptions {
  mats?: number;
  req?: number;
  structures?: string[];
  units?: Spawn[];
  technologies?: string[];
  nation?: string;
  difficulty?: AIDifficulty;
  seed?: number;
  timeLimitSec?: number | null;
  /** Put an ore field on the map so the AI has an income while it researches. */
  ore?: boolean;
}

/** Open arena with the AI base in the east. No ore: the bank is the bank. */
function arena(options: ArenaOptions = {}): Scenario {
  const scenario = createEmptyScenario(56, 56);
  scenario.meta.id = 'ai-research-test';
  scenario.settings.seed = options.seed ?? 21;
  scenario.settings.startingMats = options.mats ?? 0;
  scenario.settings.startingReq = options.req ?? 0;
  scenario.settings.timeLimitSec = options.timeLimitSec ?? null;
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 12;
  scenario.players[0].startZ = 28;
  scenario.players[1].factionId = options.nation ?? 'expeditionary';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 28;
  if (options.technologies) scenario.players[1].technologies = [...options.technologies];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 10, z: 25 },
    { defId: 'commandPost', owner: 1, x: 42, z: 25 },
  );
  const slots: Array<[number, number]> = [
    [36, 26],
    [36, 30],
    [40, 26],
    [40, 30],
    [34, 26],
  ];
  (options.structures ?? []).forEach((defId, i) => {
    scenario.structures.push({ defId, owner: 1, x: slots[i][0], z: slots[i][1] });
  });
  for (const spawn of options.units ?? []) {
    scenario.units.push({ defId: spawn.defId, owner: 1, x: spawn.x, z: spawn.z });
  }
  if (options.ore) {
    for (const [x, z] of [[31, 21], [32, 21], [31, 23], [32, 23], [30, 22], [33, 22]]) {
      scenario.tiles[z * scenario.width + x].o = 3000;
    }
  }
  return scenario;
}

const CORE = ['factory', 'refinery', 'barracks', 'powerPlant'];

/** A working base with no research of its own and nothing research-gated. */
const CORE_UNITS: Spawn[] = [
  { defId: 'engineer', x: 37, z: 28 },
  { defId: 'harvester', x: 33, z: 30 },
  { defId: 'rifle', x: 38, z: 33 },
  { defId: 'rifle', x: 34, z: 33 },
  { defId: 'atgm', x: 36, z: 33 },
];

function runAI(game: Game, seconds: number, watch?: (game: Game) => void): AIController {
  const ai = new AIController();
  const state = initialAIState(game.state.scenario.settings.seed ?? 21, 'veteran');
  // These tests measure the commander's research, not whether an unarmed human
  // seat survives its waves, so the opposing command post is kept standing.
  const hq = game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost');
  for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
    if (hq) hq.hp = hq.maxHp;
    game.tick();
    ai.update(game, 1, state);
    watch?.(game);
  }
  return ai;
}

function centreCount(game: Game): number {
  return game
    .entitiesOf(1, 'building')
    .filter((b) => b.defId === 'researchCentre' && b.hp > 0).length;
}

function signals(overrides: Partial<ResearchSignals> = {}): ResearchSignals {
  return {
    seed: 101,
    tick: 0,
    timeLimitSec: null,
    completed: [],
    unitCounts: new Map(),
    buildingCounts: new Map(),
    rosterUnits: new Set(['tank', 'ifv', 'td', 'spg', 'archer', 'uav', 'fighter']),
    exclusiveTechs: new Set(),
    profile: aiProfile(101, 'veteran'),
    strategy: 'armour',
    mix: { armour: 0, infantry: 0 },
    enemyAir: 0,
    enemyNaval: 0,
    fortified: 0,
    hasWater: true,
    ...overrides,
  };
}

describe('AI research policy', () => {
  it('starts a match with the same empty research record as a human seat', () => {
    const game = new Game(arena({ units: CORE_UNITS, mats: 2000, req: 200 }), {
      enableAI: false,
    });
    expect(game.player(0)!.research).toEqual({ completed: [], project: null });
    expect(game.player(1)!.research).toEqual({ completed: [], project: null });
    // The tier-0 roster is all it may field before it studies anything.
    const fighter = game.unitIdFor(1, 'fighter');
    expect(fighter).toBeDefined();
    expect(game.unitDefinitionUnlocked(1, fighter!)).toBe(false);
    expect(game.unitDefinitionUnlocked(1, game.unitIdFor(1, 'rifle')!)).toBe(true);
  });

  it('still honours explicit scenario grants and pre-placed content', () => {
    const scenario = arena({
      units: [{ defId: 'tank', x: 38, z: 35 }, ...CORE_UNITS],
      technologies: ['fires1'],
      mats: 1000,
      req: 200,
    });
    const game = new Game(scenario, { enableAI: false });
    const completed = game.player(1)!.research.completed;
    // The authored grant stands; the pre-placed MBT grants the slot it implies.
    expect(completed).toContain('fires1');
    expect(completed).toContain('manoeuvre1');
    // Nothing else arrives for free: this is not the removed AI tree grant.
    expect(completed.length).toBeLessThan(RESEARCH.techs.length);
    expect(completed).not.toContain('air1');
    expect(completed).not.toContain('naval1');
    // A human seat with no grants stays empty on the same map.
    expect(game.player(0)!.research.completed).toEqual([]);
  });

  it('does not found a research centre before its economy and core facilities', () => {
    const game = new Game(
      arena({ units: CORE_UNITS, mats: 1500, req: 100 }),
      { enableAI: false },
    );
    runAI(game, 120);
    expect(centreCount(game)).toBe(0);
  }, 60000);

  it('builds a research centre, pays for research and unlocks production', () => {
    const game = new Game(
      arena({ structures: CORE, units: CORE_UNITS, mats: 4000, req: 400, ore: true }),
      { enableAI: false },
    );
    // The centre is raised early and the first project is opened as soon as the
    // commander can pay for it, so the whole opening is watched rather than a
    // second stretch after it: a commander that researched quickly has already
    // finished by then and holds no project at all.
    let sawProject = false;
    let negative = false;
    runAI(game, 200, (g) => {
      if (g.player(1)!.research.project) sawProject = true;
      if (g.player(1)!.mats < 0 || g.player(1)!.req < 0) negative = true;
    });
    expect(centreCount(game)).toBe(1);
    expect(game.researchCentreId(1)).not.toBeNull();
    expect(sawProject).toBe(true);
    expect(negative).toBe(false);
    // The centre bought at least one unlock, and the unlock is real.
    const completed = game.player(1)!.research.completed;
    expect(completed.length).toBeGreaterThan(0);
    expect(new Set(completed).size).toBe(completed.length);
    const factory = game.entitiesOf(1, 'building').find((b) => b.defId === 'factory')!;
    const tank = game.unitIdFor(1, 'tank')!;
    // The gate being tested is the research unlock, not the bank: a commander
    // that has spent its income on the field must still be *able* to order the
    // hull it researched.
    game.player(1)!.mats += 5000;
    expect(game.productionStatus(1, factory.id, tank).ok).toBe(true);
    // A human seat's availability is untouched by the AI's research.
    const humanFighter = game.unitIdFor(0, 'fighter')!;
    expect(game.unitDefinitionUnlocked(0, humanFighter)).toBe(false);
  }, 90000);

  it('never founds a second research centre or spams refused placements', () => {
    const game = new Game(
      arena({ structures: CORE, units: CORE_UNITS, mats: 8000, req: 900 }),
      { enableAI: false },
    );
    runAI(game, 420);
    expect(centreCount(game)).toBe(1);
    const refusals = game.state.events.filter(
      (e) => e.type === 'orderFailed' && /Only one Research Centre/.test(e.text),
    );
    expect(refusals).toEqual([]);
  }, 60000);

  it('keeps an army reserve instead of spending its last materials on research', () => {
    const scenario = arena({
      structures: [...CORE, 'researchCentre'],
      units: [
        { defId: 'harvester', x: 33, z: 30 },
        { defId: 'rifle', x: 38, z: 33 },
        { defId: 'rifle', x: 34, z: 33 },
        { defId: 'atgm', x: 36, z: 33 },
      ],
      mats: 450,
      req: 200,
    });
    const game = new Game(scenario, { enableAI: false });
    runAI(game, 90);
    expect(game.player(1)!.research.project).toBeNull();
    // Give it a bank and the same commander queues a project immediately.
    game.player(1)!.mats = 3000;
    game.player(1)!.req = 400;
    runAI(game, 30);
    expect(
      game.player(1)!.research.project !== null ||
        game.player(1)!.research.completed.length > 0,
    ).toBe(true);
  }, 60000);

  it('rebuilds a destroyed centre without losing the project, and resumes it', () => {
    const game = new Game(
      arena({ structures: [...CORE, 'researchCentre'], units: CORE_UNITS, mats: 5000, req: 600 }),
      { enableAI: false },
    );
    runAI(game, 30);
    expect(game.player(1)!.research.project).not.toBeNull();
    const centre = game.entitiesOf(1, 'building').find((b) => b.defId === 'researchCentre')!;
    centre.hp = 0;
    runAI(game, 5);
    // The project is paused, not lost.
    expect(game.player(1)!.research.project).not.toBeNull();
    expect(game.researchPauseReason(1)).toMatch(/Research Centre/);
    expect(game.researchRate(1)).toBe(0);
    runAI(game, 300);
    expect(centreCount(game)).toBeGreaterThanOrEqual(1);
    expect(game.researchCentreId(1)).not.toBeNull();
    // The rebuild resumes the same project under the authoritative clock.
    const completed = game.player(1)!.research.completed;
    expect(completed.length + (game.player(1)!.research.project ? 1 : 0)).toBeGreaterThan(0);
  }, 90000);

  it('lets every difficulty research without free technology', () => {
    for (const difficulty of ['recruit', 'veteran', 'elite'] as const) {
      const game = new Game(
        arena({
          structures: [...CORE, 'researchCentre'],
          units: CORE_UNITS,
          mats: 3500,
          req: 400,
          difficulty,
        }),
        { enableAI: false },
      );
      expect(game.player(1)!.research.completed).toEqual([]);
      const ai = new AIController();
      const state = initialAIState(21, difficulty);
      for (let i = 0; i < 20 * 320 && game.state.victory === 'playing'; i++) {
        game.tick();
        ai.update(game, 1, state);
      }
      expect(game.player(1)!.research.completed.length, difficulty).toBeGreaterThan(0);
      // Nothing was handed over: every completion has a prerequisite closure.
      for (const tech of game.player(1)!.research.completed) {
        const def = techDef(tech)!;
        for (const required of def.requires) {
          expect(game.player(1)!.research.completed).toContain(required);
        }
      }
    }
  }, 120000);

  it('never cancels a project it started', () => {
    const game = new Game(
      arena({ structures: [...CORE, 'researchCentre'], units: CORE_UNITS, mats: 4000, req: 800 }),
      { enableAI: false },
    );
    let lastProject: string | null = null;
    let lastCompleted = 0;
    const cancellations: string[] = [];
    runAI(game, 400, (g) => {
      const research = g.player(1)!.research;
      const project = research.project?.techId ?? null;
      if (lastProject && !project && research.completed.length === lastCompleted) {
        cancellations.push(lastProject);
      }
      lastProject = project;
      lastCompleted = research.completed.length;
    });
    expect(cancellations).toEqual([]);
    expect(game.player(1)!.research.completed.length).toBeGreaterThan(0);
    // Completion order respects every prerequisite.
    const completed = game.player(1)!.research.completed;
    for (const id of completed) {
      const def = techDef(id)!;
      for (const required of def.requires) {
        expect(completed.indexOf(required)).toBeLessThan(completed.indexOf(id));
      }
    }
  }, 90000);

  it('replays the same research decisions on an identical seed', () => {
    const play = (): Game => {
      const game = new Game(
        arena({ structures: CORE, units: CORE_UNITS, mats: 4000, req: 400 }),
        { enableAI: false },
      );
      runAI(game, 260);
      return game;
    };
    const first = play();
    const second = play();
    expect(first.player(1)!.research.completed).toEqual(second.player(1)!.research.completed);
    expect(first.player(1)!.research.project).toEqual(second.player(1)!.research.project);
    expect(first.stateHash()).toBe(second.stateHash());
  }, 90000);
});

describe('AI research scoring', () => {
  it('values the anti-armour tier once armour has been scouted', () => {
    const tech = techDef('manoeuvre2')!;
    const completed = ['manoeuvre1'];
    const infantryHeavy = researchOptionScore(
      tech,
      signals({ completed, mix: { armour: 0, infantry: 6 } }),
    );
    const armourHeavy = researchOptionScore(
      tech,
      signals({ completed, mix: { armour: 6, infantry: 1 } }),
    );
    expect(armourHeavy.score).toBeGreaterThan(infantryHeavy.score);
    expect(armourHeavy.score).toBeGreaterThan(RESEARCH_MIN_SCORE);
    expect(armourHeavy.reason).toContain('td');
  });

  it('values air defence more once hostile air has been identified', () => {
    const tech = techDef('air1')!;
    const quiet = researchOptionScore(tech, signals());
    const threatened = researchOptionScore(tech, signals({ enemyAir: 3 }));
    expect(threatened.score).toBeGreaterThan(quiet.score);
  });

  it('refuses a naval branch on a map with no water', () => {
    const tech = techDef('naval1')!;
    const dry = researchOptionScore(tech, signals({ hasWater: false }));
    const wet = researchOptionScore(tech, signals({ hasWater: true }));
    expect(dry.score).toBe(0);
    expect(wet.score).toBeGreaterThan(0);
  });

  it('refuses an implemented upgrade when nothing in the roster can fire it', () => {
    const catalog: ResearchCatalog = {
      techs: [
        {
          id: 'fixtureUpgrade',
          name: 'Fixture Upgrade',
          easternName: 'Fixture Upgrade',
          branch: 'manoeuvre',
          tier: 1,
          cost: { mats: 100, req: 10 },
          seconds: 20,
          requires: [],
          effects: [{ kind: 'grantUnitUpgrade', upgrade: 'reconSmokescreen' }],
          description: '',
          icon: 'recon',
        } satisfies TechDef,
        {
          id: 'fixtureModule',
          name: 'Fixture Module',
          easternName: 'Fixture Module',
          branch: 'manoeuvre',
          tier: 1,
          cost: { mats: 100, req: 10 },
          seconds: 20,
          requires: [],
          effects: [{ kind: 'grantBuildingModule', module: 'advancedTurbine' }],
          description: '',
          icon: 'power',
        } satisfies TechDef,
      ],
      upgrades: RESEARCH.upgrades,
      modules: RESEARCH.modules,
    };
    // This commander fields no recon slot, so the smoke upgrade has no hull to
    // fire it from and the module has no installation path at all.
    for (const tech of catalog.techs) {
      const option = researchOptionScore(tech, signals());
      expect(option.score).toBe(0);
      expect(option.reason).toBe('no playable effect');
    }
  });

  it('does not value a slot the commander\u2019s nation never fields', () => {
    // Advanced Armour used to be this fixture, but it now also grants hull-down
    // and active protection, which this roster can fire. The invariant is
    // therefore tested on a node whose only content is the unfielded slot.
    const tech = {
      id: 'fixtureSlot',
      name: 'Fixture Slot',
      easternName: 'Fixture Slot',
      branch: 'manoeuvre',
      tier: 2,
      cost: { mats: 600, req: 90 },
      seconds: 80,
      requires: [],
      effects: [{ kind: 'unlockUnit', slot: 'td' }],
      description: '',
      icon: 'td',
    } satisfies TechDef;
    const option = researchOptionScore(
      tech,
      signals({ completed: ['manoeuvre1'], rosterUnits: new Set(['tank', 'ifv']) }),
    );
    expect(option.score).toBe(0);
  });

  it('reports a completed or still-locked node as unscoreable', () => {
    const tech = techDef('manoeuvre2')!;
    expect(researchOptionScore(tech, signals({ completed: ['manoeuvre1', 'manoeuvre2'] })).score).toBe(0);
    const locked = researchOptionScore(tech, signals());
    expect(locked.score).toBe(0);
    expect(locked.reason).toBe('prerequisite incomplete');
  });

  it('discounts a long project that would outlive the match clock', () => {
    const tech = techDef('air2')!;
    const completed = ['air1'];
    const early = researchOptionScore(
      tech,
      signals({ completed, tick: 20 * 60, timeLimitSec: 600 }),
    );
    const late = researchOptionScore(
      tech,
      signals({ completed, tick: 20 * 560, timeLimitSec: 600 }),
    );
    expect(late.score).toBeLessThan(early.score);
  });
});
