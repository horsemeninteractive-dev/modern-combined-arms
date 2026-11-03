import {
  RESEARCH,
  RESEARCH_BRANCHES,
  BRANCH_NAMES,
  techDef,
  techDisplayName,
  type ResearchBranch,
  type ResearchCatalog,
  type TechDef,
} from '../data/research';
import type { ResearchProject } from '../sim/types';

/**
 * Presentation state for one technology node.
 *
 * The catalogue owns costs, effects and prerequisites; the simulation owns
 * completion and the active project. This module only classifies those facts
 * for the tree, so the panel never invents a status the command handler would
 * not agree with.
 */
export type ResearchNodeStatus =
  | 'completed'
  | 'researching'
  | 'available'
  | 'prerequisite'
  | 'faction'
  | 'busy'
  | 'resources'
  | 'no-centre';

export interface ResearchNodeInput {
  completed: readonly string[];
  project: ResearchProject | null;
  mats: number;
  req: number;
  hasCentre: boolean;
  /** Alliance id used for both doctrine names and restrictions. */
  allianceId?: string;
  /** Nation/faction id used by nation-restricted technologies. */
  factionId?: string;
}

export interface ResearchNodeView {
  tech: TechDef;
  name: string;
  status: ResearchNodeStatus;
  /** Short status pill, e.g. READY or LOCKED. */
  label: string;
  /** One sentence explaining the state, including the missing prerequisite. */
  reason: string;
  canStart: boolean;
}

const STATUS_LABELS: Record<ResearchNodeStatus, string> = {
  completed: 'COMPLETED',
  researching: 'RESEARCHING',
  available: 'READY',
  prerequisite: 'LOCKED',
  faction: 'RESTRICTED',
  busy: 'PROJECT ACTIVE',
  resources: 'NEED RESOURCES',
  'no-centre': 'NO CENTRE',
};

/** The name the selected nation's alliance would read in its own tree. */
export function researchTechName(tech: TechDef, allianceId?: string): string {
  return techDisplayName(tech, allianceId);
}

/**
 * Classify one technology in display priority order.
 *
 * A completed or active node outranks availability; a permanent faction
 * restriction outranks a prerequisite the player could still research. When a
 * player could start the node but lacks money or a centre, the reason names
 * the specific shortage rather than a generic "unavailable".
 */
export function researchNodeState(
  tech: TechDef,
  input: ResearchNodeInput,
  catalog: ResearchCatalog = RESEARCH,
): ResearchNodeView {
  const name = researchTechName(tech, input.allianceId);
  const completed = new Set(input.completed);
  if (completed.has(tech.id)) {
    return {
      tech,
      name,
      status: 'completed',
      label: STATUS_LABELS.completed,
      reason: 'Researched.',
      canStart: false,
    };
  }
  if (input.project?.techId === tech.id) {
    return {
      tech,
      name,
      status: 'researching',
      label: STATUS_LABELS.researching,
      reason: `${Math.ceil(input.project.remaining)}s remaining.`,
      canStart: false,
    };
  }
  if (tech.alliances && (!input.allianceId || !tech.alliances.includes(input.allianceId))) {
    return {
      tech,
      name,
      status: 'faction',
      label: STATUS_LABELS.faction,
      reason: 'Not available to this alliance.',
      canStart: false,
    };
  }
  if (tech.nations && (!input.factionId || !tech.nations.includes(input.factionId))) {
    return {
      tech,
      name,
      status: 'faction',
      label: STATUS_LABELS.faction,
      reason: 'Not available to this nation.',
      canStart: false,
    };
  }
  const missing = tech.requires.filter((id) => !completed.has(id));
  if (missing.length > 0) {
    const names = missing.map((id) => {
      const required = techDef(id, catalog);
      return required ? researchTechName(required, input.allianceId) : id;
    });
    return {
      tech,
      name,
      status: 'prerequisite',
      label: STATUS_LABELS.prerequisite,
      reason: `Requires ${names.join(' and ')}.`,
      canStart: false,
    };
  }
  if (input.project) {
    const active = techDef(input.project.techId, catalog);
    const activeName = active ? researchTechName(active, input.allianceId) : input.project.techId;
    return {
      tech,
      name,
      status: 'busy',
      label: STATUS_LABELS.busy,
      reason: `${activeName} is already in progress.`,
      canStart: false,
    };
  }
  if (!input.hasCentre) {
    return {
      tech,
      name,
      status: 'no-centre',
      label: STATUS_LABELS['no-centre'],
      reason: 'Build an operational Research Centre first.',
      canStart: false,
    };
  }
  const shortages: string[] = [];
  if (input.mats < tech.cost.mats) shortages.push(`${tech.cost.mats - input.mats} more materials`);
  if (input.req < tech.cost.req) shortages.push(`${tech.cost.req - input.req} more requisition`);
  if (shortages.length > 0) {
    return {
      tech,
      name,
      status: 'resources',
      label: STATUS_LABELS.resources,
      reason: `Need ${shortages.join(' and ')}.`,
      canStart: false,
    };
  }
  return {
    tech,
    name,
    status: 'available',
    label: STATUS_LABELS.available,
    reason: 'Ready to research.',
    canStart: true,
  };
}

/** The four approved branches with their two tiers in catalogue order. */
export function researchBranchGroups(
  catalog: ResearchCatalog = RESEARCH,
): Array<{ branch: ResearchBranch; label: string; nodes: TechDef[] }> {
  return RESEARCH_BRANCHES.map((branch) => ({
    branch,
    label: BRANCH_NAMES[branch],
    nodes: catalog.techs
      .filter((tech) => tech.branch === branch)
      .slice()
      .sort((a, b) => a.tier - b.tier),
  }));
}

export interface ActiveResearchView {
  tech: TechDef;
  name: string;
  progress: number;
  remaining: number;
  total: number;
  percent: number;
}

/** Progress and display name for the project currently occupying the centre. */
export function activeResearchView(
  project: ResearchProject | null,
  allianceId?: string,
  catalog: ResearchCatalog = RESEARCH,
): ActiveResearchView | null {
  if (!project) return null;
  const tech = techDef(project.techId, catalog);
  if (!tech) return null;
  const total = Math.max(0, project.total);
  const remaining = Math.max(0, Math.min(total, project.remaining));
  const progress = total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
  return {
    tech,
    name: researchTechName(tech, allianceId),
    progress,
    remaining,
    total,
    percent: Math.round(progress * 100),
  };
}

/** Comma-separated names for a set of technologies, used in card reasons. */
export function researchNames(techs: readonly TechDef[], allianceId?: string): string {
  return techs.map((tech) => researchTechName(tech, allianceId)).join(' and ');
}
