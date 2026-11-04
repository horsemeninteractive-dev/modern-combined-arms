/**
 * Presentation model for the strategic operations panel.
 *
 * The simulation already answers every question the panel needs through
 * `SuperweaponStatus`; this module only decides how that answer reads. Keeping
 * the wording out of the HUD means the same state words reach the rail chip, the
 * panel and the tests, and a nation with no capability produces a coherent
 * explanation instead of an empty shell.
 */
import {
  formatSuperweaponClock,
  type SuperweaponFamilyDef,
  type SuperweaponTargeting,
} from '../data/superweapons';
import type { SuperweaponStatus } from '../sim/superweapons';

export type SuperweaponTone = 'ready' | 'charging' | 'locked' | 'active' | 'unavailable';

export interface SuperweaponRequirement {
  id: string;
  name: string;
  ready: boolean;
}

export interface SuperweaponView {
  family: SuperweaponFamilyDef | null;
  /** Field name the commander's own alliance reads. */
  name: string;
  role: string;
  description: string;
  tone: SuperweaponTone;
  /** Two or three word state shown on the chip and panel header. */
  label: string;
  /** One sentence explaining the state, never a raw error code. */
  detail: string;
  canFire: boolean;
  /** Reload or operation countdown; empty when nothing is counting down. */
  clock: string;
  targeting: SuperweaponTargeting | null;
  targetLabel: string;
  warningSeconds: number;
  cooldownSeconds: number;
  cost: { mats: number; req: number } | null;
  centreReady: boolean;
  requirements: SuperweaponRequirement[];
  missingTechs: string[];
  /** True while this commander's own operation is still running. */
  operationRunning: boolean;
}

/** What an author has to click or drag for each targeting mode. */
export const SUPERWEAPON_TARGET_LABEL: Readonly<Record<SuperweaponTargeting, string>> = Object.freeze(
  {
    enemyStructure: 'Click one hostile structure you can currently see.',
    enemyArea: 'Click ground you can currently see to aim the barrage.',
    enemyNetwork: 'Click a seen enemy position holding a fielded network.',
    friendlyArea: 'Click ground covered by your own forces.',
  },
);

const TARGET_SHORT: Readonly<Record<SuperweaponTargeting, string>> = Object.freeze({
  enemyStructure: 'HOSTILE STRUCTURE',
  enemyArea: 'SEEN ENEMY AREA',
  enemyNetwork: 'SEEN ENEMY NETWORK',
  friendlyArea: 'OWN FORCES',
});

/**
 * Turn one authoritative status into the panel's wording.
 *
 * Order matters and matches `Game.superweaponStatus`: the first unmet gate is
 * the one the author is told about, so the panel never asks for research while
 * the structure is also missing.
 */
export function superweaponView(
  status: SuperweaponStatus,
  presentation: { name: string; description: string } | null,
): SuperweaponView {
  const family = status.family;
  const requirements: SuperweaponRequirement[] = status.requires.map((req) => ({
    id: req.id,
    name: req.name,
    ready: req.ready,
  }));
  const base = {
    family,
    name: presentation?.name ?? family?.name ?? 'No strategic capability',
    role: family?.role ?? 'National capability',
    description: presentation?.description ?? '',
    clock: '',
    targeting: status.targeting,
    targetLabel: status.targeting ? TARGET_SHORT[status.targeting] : '',
    warningSeconds: family?.warningSeconds ?? 0,
    cooldownSeconds: family?.cooldownSeconds ?? 0,
    cost: status.cost,
    centreReady: status.hasCentre,
    requirements,
    missingTechs: status.missingTechs.map((tech) => tech.name),
    operationRunning: !!status.operation,
  };

  if (!status.enabled) {
    return {
      ...base,
      tone: 'unavailable',
      label: 'DISABLED',
      detail: 'This battle does not permit strategic superweapons.',
      canFire: false,
    };
  }
  if (!family) {
    return {
      ...base,
      tone: 'unavailable',
      label: 'NO CAPABILITY',
      detail:
        'This nation fields no strategic superweapon. Its other national strengths are unaffected.',
      canFire: false,
    };
  }
  if (status.operation) {
    const warning = status.phase === 'warning';
    return {
      ...base,
      tone: 'active',
      label: warning ? 'AUTHORISED' : 'EXECUTING',
      detail: warning
        ? `The operation resolves in ${Math.ceil(status.countdown)}s and cannot be recalled.`
        : `The operation is resolving; ${Math.ceil(status.countdown)}s of effect remain.`,
      canFire: false,
      clock: formatSuperweaponClock(status.countdown),
    };
  }
  if (!status.hasCentre) {
    return {
      ...base,
      tone: 'locked',
      label: 'NEEDS CENTRE',
      detail:
        'Build a Strategic Operations Centre to authorise the national call-in. It has no weapon of its own.',
      canFire: false,
    };
  }
  if (status.missingTechs.length > 0) {
    return {
      ...base,
      tone: 'locked',
      label: 'AUTHORITY CHAIN',
      detail: `${status.missingTechs.length} required ${
        status.missingTechs.length === 1 ? 'technology is' : 'technologies are'
      } still incomplete.`,
      canFire: false,
    };
  }
  if (status.cooldown > 0) {
    return {
      ...base,
      tone: 'charging',
      label: 'NATIONAL RELOAD',
      detail: `The capability reloads in ${formatSuperweaponClock(status.cooldown)}. Rebuilding the centre does not shorten it.`,
      canFire: false,
      clock: formatSuperweaponClock(status.cooldown),
    };
  }
  if (!status.affordable) {
    return {
      ...base,
      tone: 'locked',
      label: 'RESUPPLY',
      detail: `Authorisation costs ${family.cost.mats} materials and ${family.cost.req} requisition.`,
      canFire: false,
    };
  }
  return {
    ...base,
    tone: 'ready',
    label: 'READY',
    detail: family.targeting === 'friendlyArea'
      ? 'Ready to establish the defensive field over your own forces.'
      : 'Ready to authorise. The target is chosen on the map.',
    canFire: true,
  };
}
