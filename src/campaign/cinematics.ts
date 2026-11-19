/**
 * Authored campaign framing scenes.
 *
 * Campaign definitions are shipped data, so an in-engine edit is kept as a
 * separate, versioned overlay in browser storage. The overlay only replaces
 * `cinematics`; operations, variables, roster and progression stay in the
 * definition. A stored overlay that no longer validates is ignored rather than
 * allowed to break a campaign launch.
 */
import type { CampaignDef } from '../data/campaign';
import type { MissionCinematicDoc } from '../mission/types';
import { validateCampaignDefinition } from './validate';

export const CAMPAIGN_CINEMATICS_KEY = 'iron-tide.campaign-cinematics.v1';

export const CAMPAIGN_CINEMATIC_CONTEXTS = [
  'campaignIntro',
  'intermission',
  'campaignFinale',
] as const;

export type CampaignCinematicContext = (typeof CAMPAIGN_CINEMATIC_CONTEXTS)[number];

export interface CampaignCinematicStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CampaignCinematicStore {
  version: 1;
  campaigns: Record<string, MissionCinematicDoc[]>;
}

function clone<T>(value: readonly T[]): T[] {
  return JSON.parse(JSON.stringify(value)) as T[];
}

function isCampaignDoc(value: unknown): value is MissionCinematicDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<MissionCinematicDoc>;
  return (
    typeof doc.id === 'string' &&
    doc.id.length > 0 &&
    CAMPAIGN_CINEMATIC_CONTEXTS.includes(doc.kind as CampaignCinematicContext) &&
    Array.isArray(doc.steps) &&
    Array.isArray(doc.dialogue)
  );
}

/**
 * Read the overlay. Missing, damaged or newer data yields an empty overlay;
 * callers fall back to the shipped definition rather than failing to open.
 */
export function readCampaignCinematics(
  storage: CampaignCinematicStorage,
): Record<string, MissionCinematicDoc[]> {
  let parsed: unknown;
  try {
    const raw = storage.getItem(CAMPAIGN_CINEMATICS_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const store = parsed as Partial<CampaignCinematicStore>;
  if (store.version !== 1 || !store.campaigns || typeof store.campaigns !== 'object') return {};
  const campaigns: Record<string, MissionCinematicDoc[]> = {};
  for (const [campaignId, value] of Object.entries(store.campaigns)) {
    if (!Array.isArray(value)) continue;
    const docs = value.filter(isCampaignDoc);
    if (docs.length !== value.length) continue;
    campaigns[campaignId] = clone(docs);
  }
  return campaigns;
}

/** The stored campaign scenes when valid, otherwise the shipped ones. */
export function campaignCinematicsFor(
  def: CampaignDef,
  storage: CampaignCinematicStorage,
): MissionCinematicDoc[] {
  const stored = readCampaignCinematics(storage)[def.id];
  if (!stored) return clone(def.cinematics ?? []);
  try {
    const issues = validateCampaignDefinition({ ...def, cinematics: stored }).filter(
      (issue) => issue.severity === 'error' && issue.code.startsWith('campaign-cinematic'),
    );
    if (issues.length > 0) return clone(def.cinematics ?? []);
  } catch {
    return clone(def.cinematics ?? []);
  }
  return clone(stored);
}

/** Apply the authored overlay to one campaign definition. */
export function campaignWithCinematics(
  def: CampaignDef,
  storage: CampaignCinematicStorage,
): CampaignDef {
  return { ...def, cinematics: campaignCinematicsFor(def, storage) };
}

/** Persist one campaign's complete scene list. */
export function saveCampaignCinematics(
  storage: CampaignCinematicStorage,
  campaignId: string,
  cinematics: readonly MissionCinematicDoc[],
): void {
  const campaigns = readCampaignCinematics(storage);
  campaigns[campaignId] = clone(cinematics);
  const store: CampaignCinematicStore = { version: 1, campaigns };
  storage.setItem(CAMPAIGN_CINEMATICS_KEY, JSON.stringify(store));
}

/** Drop the authored overlay and return to the shipped definition. */
export function clearCampaignCinematics(
  storage: CampaignCinematicStorage,
  campaignId: string,
): void {
  const campaigns = readCampaignCinematics(storage);
  if (!(campaignId in campaigns)) return;
  delete campaigns[campaignId];
  storage.setItem(CAMPAIGN_CINEMATICS_KEY, JSON.stringify({ version: 1, campaigns } satisfies CampaignCinematicStore));
}

