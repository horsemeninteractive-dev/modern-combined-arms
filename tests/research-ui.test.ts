import { describe, expect, it } from 'vitest';
import { RESEARCH, TECHS, type TechDef } from '../src/data/research';
import {
  activeResearchView,
  researchBranchGroups,
  researchNodeState,
  researchTechName,
} from '../src/ui/researchView';

const BASE = {
  completed: [] as string[],
  project: null,
  mats: 2000,
  req: 500,
  hasCentre: true,
  allianceId: 'defender',
  factionId: 'lithuania',
};

const EASTERN_TECH: TechDef = {
  ...TECHS.manoeuvre1,
  id: 'easternOnly',
  alliances: ['eastern'],
};

const POLISH_TECH: TechDef = {
  ...TECHS.manoeuvre1,
  id: 'polishOnly',
  nations: ['poland'],
};

describe('research tree view state', () => {
  it('presents all four branches with both approved tiers', () => {
    const groups = researchBranchGroups();
    expect(groups.map((group) => group.branch)).toEqual([
      'manoeuvre',
      'fires',
      'air',
      'naval',
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      'Manoeuvre',
      'Fires',
      'Air',
      'Naval',
    ]);
    expect(groups.flatMap((group) => group.nodes)).toHaveLength(8);
    for (const group of groups) {
      expect(group.nodes.map((tech) => tech.tier)).toEqual([1, 2]);
    }
  });

  it('uses the real cost and duration metadata', () => {
    const view = researchNodeState(TECHS.manoeuvre1, BASE);
    expect(view.tech.cost).toEqual({ mats: 300, req: 40 });
    expect(view.tech.seconds).toBe(45);
    expect(view.status).toBe('available');
    expect(view.canStart).toBe(true);
  });

  it('distinguishes completed, researching, available and prerequisite states', () => {
    expect(
      researchNodeState(TECHS.manoeuvre1, { ...BASE, completed: ['manoeuvre1'] }).status,
    ).toBe('completed');
    expect(
      researchNodeState(TECHS.manoeuvre1, {
        ...BASE,
        project: { techId: 'manoeuvre1', remaining: 12, total: 45 },
      }).status,
    ).toBe('researching');
    expect(researchNodeState(TECHS.manoeuvre1, BASE).status).toBe('available');
    const locked = researchNodeState(TECHS.manoeuvre2, BASE);
    expect(locked.status).toBe('prerequisite');
    expect(locked.reason).toContain('Manoeuvre Doctrine');
    expect(locked.canStart).toBe(false);
  });

  it('shows faction restrictions without pretending the node is merely poor', () => {
    const alliance = researchNodeState(EASTERN_TECH, BASE);
    expect(alliance.status).toBe('faction');
    expect(alliance.reason).toMatch(/alliance/);
    const nation = researchNodeState(POLISH_TECH, BASE);
    expect(nation.status).toBe('faction');
    expect(nation.reason).toMatch(/nation/);
  });

  it('distinguishes another active project, a missing centre and resource shortages', () => {
    const busy = researchNodeState(TECHS.manoeuvre1, {
      ...BASE,
      project: { techId: 'fires1', remaining: 20, total: 45 },
    });
    expect(busy.status).toBe('busy');
    expect(busy.reason).toContain('Indirect Fire Control');

    const noCentre = researchNodeState(TECHS.manoeuvre1, { ...BASE, hasCentre: false });
    expect(noCentre.status).toBe('no-centre');
    expect(noCentre.reason).toMatch(/Research Centre/);

    const poor = researchNodeState(TECHS.manoeuvre1, { ...BASE, mats: 0, req: 0 });
    expect(poor.status).toBe('resources');
    expect(poor.reason).toContain('materials');
    expect(poor.reason).toContain('requisition');
  });

  it('uses the alliance doctrine name and never invents a technology', () => {
    expect(researchTechName(TECHS.fires1, 'eastern')).toBe('Massed Fires');
    expect(researchNodeState(TECHS.fires1, { ...BASE, allianceId: 'eastern' }).name).toBe(
      'Massed Fires',
    );
    // The eight branch nodes come first, in catalogue order, exactly as the
    // panel lists them; the strategic authority nodes follow as their own class.
    expect(RESEARCH.techs.filter((tech) => !tech.strategic).map((tech) => tech.id)).toEqual([
      'manoeuvre1',
      'manoeuvre2',
      'fires1',
      'fires2',
      'air1',
      'air2',
      'naval1',
      'naval2',
    ]);
    expect(RESEARCH.techs.filter((tech) => tech.strategic).every((tech) => tech.effects.length === 0)).toBe(true);
  });

  it('reports authoritative project progress and remaining time', () => {
    const active = activeResearchView(
      { techId: 'manoeuvre1', remaining: 15, total: 45 },
      'defender',
    );
    expect(active).not.toBeNull();
    expect(active!.name).toBe('Manoeuvre Doctrine');
    expect(active!.progress).toBeCloseTo(2 / 3, 6);
    expect(active!.percent).toBe(67);
    expect(active!.remaining).toBe(15);
    expect(activeResearchView(null)).toBeNull();
  });
});
