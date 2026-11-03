/**
 * Defensive priority across controlled scouting and economic conditions.
 *
 * Phase 14 showed one cell of this surface: two scouted rifle squads against one
 * machine-gun nest make a second nest outrank a second refinery. This file maps
 * the whole surface, one legitimate input at a time, and pins the rule that
 * produces it:
 *
 *   - the perimeter answers the *dominant scouted arm*, two of that arm and one
 *     of the other, and asks for nothing once those are standing;
 *   - a balanced or absent scouting report never asks for an emplacement;
 *   - when the perimeter is answered, the next construction is economic, whether
 *     that is a second drop-off or a radar depending on hauler capacity.
 *
 * No hidden enemy is used anywhere here: every scouted unit is visible.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import {
  AIController,
  initialAIState,
  defenceTargets,
  nextDefenceBuild,
  type ScoutedForceMix,
} from '../src/sim/ai';
import { tileIndex } from '../src/sim/terrain';
import { RESEARCH } from '../src/data/research';

interface Fixture {
  infantry?: number;
  tanks?: number;
  mgNest?: number;
  atTurret?: number;
  refineries?: number;
  harvesters?: number;
  mats?: number;
}

const SEED = 11;

function scenarioFor(f: Fixture) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = false;
  scenario.settings.startingMats = f.mats ?? 2000;
  scenario.settings.startingReq = 200;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    { defId: 'factory', owner: 1, x: 40, z: 31 },
    { defId: 'barracks', owner: 1, x: 40, z: 35 },
    { defId: 'airfield', owner: 1, x: 36, z: 29 },
    { defId: 'powerPlant', owner: 1, x: 36, z: 35 },
    { defId: 'powerPlant', owner: 1, x: 36, z: 37 },
  );
  for (let i = 0; i < (f.refineries ?? 1); i++) {
    scenario.structures.push({ defId: 'refinery', owner: 1, x: 48 + i * 4, z: 31 });
  }
  for (let i = 0; i < (f.atTurret ?? 1); i++) {
    scenario.structures.push({ defId: 'atTurret', owner: 1, x: 50 + i, z: 27 });
  }
  for (let i = 0; i < (f.mgNest ?? 1); i++) {
    scenario.structures.push({ defId: 'mgNest', owner: 1, x: 46 + i, z: 39 });
  }
  // The tree is already finished, so the commander has nothing left to study and
  // no reason to site a research centre. That keeps the measured choice on the
  // perimeter and the economy, which is what these fixtures are about.
  scenario.players[1].technologies = RESEARCH.techs.map((tech) => tech.id);
  scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  for (let i = 0; i < (f.harvesters ?? 2); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  // A working deposit keeps the economy option meaningful; without ore every
  // hauler idles, and the commander withholds a second drop-off by rule.
  for (let z = 34; z <= 37; z++) {
    for (let x = 56; x <= 59; x++) scenario.tiles[tileIndex(64, x, z)].o = 600;
  }
  for (let i = 0; i < (f.infantry ?? 0); i++) {
    scenario.units.push({ defId: 'rifle', owner: 0, x: 40 + i, z: 33 });
  }
  for (let i = 0; i < (f.tanks ?? 0); i++) {
    scenario.units.push({ defId: 'tank', owner: 0, x: 40, z: 35 + i });
  }
  return scenario;
}

function firstBuild(f: Fixture): string | null {
  const game = new Game(scenarioFor(f), { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  const before = new Set(game.entitiesOf(1, 'building').map((b) => b.id));
  for (let i = 0; i < 20 * 30; i++) {
    game.tick();
    ai.update(game, 1, state);
    const site = game.entitiesOf(1, 'building').find((b) => !before.has(b.id));
    if (site) return site.defId;
  }
  return null;
}

describe('defensive priority', () => {
  it('asks for two of the dominant scouted arm and one of the other', () => {
    expect(defenceTargets({ armour: 0, infantry: 0 })).toEqual({ atTurret: 1, mgNest: 1 });
    expect(defenceTargets({ armour: 1, infantry: 1 })).toEqual({ atTurret: 1, mgNest: 1 });
    expect(defenceTargets({ armour: 0, infantry: 3 })).toEqual({ atTurret: 1, mgNest: 2 });
    expect(defenceTargets({ armour: 2, infantry: 0 })).toEqual({ atTurret: 2, mgNest: 1 });
  });

  it('asks for nothing once the perimeter answers the scouted force', () => {
    // The same scouting report that wanted one more nest is satisfied by two.
    expect(nextDefenceBuild({ armour: 1, infantry: 2 }, { atTurret: 1, mgNest: 1 })).toBe('mgNest');
    expect(nextDefenceBuild({ armour: 1, infantry: 2 }, { atTurret: 1, mgNest: 2 })).toBeNull();
    expect(nextDefenceBuild({ armour: 2, infantry: 1 }, { atTurret: 1, mgNest: 1 })).toBe('atTurret');
    expect(nextDefenceBuild({ armour: 2, infantry: 1 }, { atTurret: 2, mgNest: 1 })).toBeNull();
    // Balanced scouting never doubles either armament.
    expect(nextDefenceBuild({ armour: 2, infantry: 2 }, { atTurret: 1, mgNest: 1 })).toBeNull();
  });

  it('answers an unbalanced report and leaves a balanced one to the economy', () => {
    expect(firstBuild({ infantry: 2, mgNest: 1 })).toBe('mgNest');
    expect(firstBuild({ tanks: 2, atTurret: 1 })).toBe('atTurret');
    expect(firstBuild({ infantry: 1, tanks: 1 })).toBe('refinery');
    expect(firstBuild({ infantry: 2, mgNest: 2 })).toBe('refinery');
    expect(firstBuild({ tanks: 2, atTurret: 2 })).toBe('refinery');
  });

  it('does not keep building emplacements beyond the scouted demand', () => {
    // Five squads seen, two nests standing: the demand is already answered, so
    // a larger sighting does not buy a third nest.
    expect(firstBuild({ infantry: 5, mgNest: 2 })).toBe('refinery');
    expect(firstBuild({ infantry: 5, mgNest: 2, atTurret: 2 })).toBe('refinery');
    // The same is true against armour.
    expect(firstBuild({ tanks: 5, atTurret: 2 })).toBe('refinery');
  });

  it('keeps the economic option when the drop-off is already saturated or not', () => {
    // Two drop-offs with three haulers: a third is not requested, so the next
    // construction is the radar. Defensive demand still wins when it exists.
    expect(firstBuild({ refineries: 2, harvesters: 3 })).toBe('radar');
    expect(firstBuild({ refineries: 2, harvesters: 3, infantry: 2, mgNest: 1 })).toBe('mgNest');
  });

  it('lets a full perimeter fall back to the economy on the same scouting', () => {
    // One nest short: the nest. One nest more: the refinery, with the same two
    // rifle squads visible — the rule is the unmet demand, not the sighting.
    expect(firstBuild({ infantry: 2, mgNest: 1 })).toBe('mgNest');
    expect(firstBuild({ infantry: 2, mgNest: 2 })).toBe('refinery');
  });

  it('holds the unmet-demand invariant across the measured surface', () => {
    // 12 scouting reports × 5 standing perimeters × 2 economies = 120 cells.
    // In every one the building ordered is exactly the unmet demand, and when
    // the demand is met the order is economic — the second drop-off where the
    // haulers have saturated what stands, the radar where they have not.
    const reports: ScoutedForceMix[] = [
      { armour: 0, infantry: 0 },
      { armour: 1, infantry: 1 },
      { armour: 2, infantry: 2 },
      { armour: 3, infantry: 3 },
      { armour: 1, infantry: 0 },
      { armour: 2, infantry: 1 },
      { armour: 3, infantry: 1 },
      { armour: 0, infantry: 1 },
      { armour: 1, infantry: 2 },
      { armour: 1, infantry: 3 },
      { armour: 0, infantry: 5 },
      { armour: 5, infantry: 0 },
    ];
    const perimeter = [
      { atTurret: 0, mgNest: 0 },
      { atTurret: 1, mgNest: 1 },
      { atTurret: 2, mgNest: 1 },
      { atTurret: 1, mgNest: 2 },
      { atTurret: 2, mgNest: 2 },
    ];
    const economies = [
      { refineries: 1, harvesters: 2, economic: 'refinery' },
      { refineries: 2, harvesters: 3, economic: 'radar' },
    ];
    const failures: string[] = [];
    for (const economy of economies) {
      for (const standing of perimeter) {
        for (const report of reports) {
          const demand = nextDefenceBuild(report, standing);
          const built = firstBuild({
            infantry: report.infantry,
            tanks: report.armour,
            ...standing,
            refineries: economy.refineries,
            harvesters: economy.harvesters,
          });
          const cell = `${report.infantry}i/${report.armour}a, perimeter ${standing.atTurret}/${standing.mgNest}, ${economy.refineries}r/${economy.harvesters}h`;
          if (demand) {
            if (built !== demand) failures.push(`${cell}: wanted ${demand}, ordered ${built}`);
          } else if (built === 'atTurret' || built === 'mgNest') {
            failures.push(`${cell}: ordered ${built} with no unmet demand`);
          } else if (built !== economy.economic) {
            failures.push(`${cell}: expected ${economy.economic}, ordered ${built}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('makes the same defensive decision twice on identical worlds', () => {
    const f: Fixture = { infantry: 2, mgNest: 1 };
    expect(firstBuild(f)).toBe(firstBuild(f));
    const a = new Game(scenarioFor(f), { enableAI: false });
    const b = new Game(scenarioFor(f), { enableAI: false });
    expect(a.stateHash()).toBe(b.stateHash());
  });
});
