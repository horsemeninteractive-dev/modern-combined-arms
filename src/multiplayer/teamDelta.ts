import type { QueueItem, SmokeCloud } from '../sim/types';
import type {
  ProjectedEntity,
  ProjectedMatchResult,
  ProjectedPlayer,
  ProjectedProjectile,
  ProjectedTeamState,
  TeamSnapshot,
} from './projection';
import type { DeltaChanges } from './protocol';

/**
 * Per-seat delta encoder.
 *
 * The authoritative room keeps one baseline per connected seat: the exact
 * projected state that seat already received. Every 10 Hz update is compared
 * against that baseline and only differences are serialised. The baseline holds
 * projected objects only, never `GameState`, and is replaced (not mutated) after
 * every successful send.
 */
export interface SyncBaseline {
  tick: number;
  entities: Map<number, ProjectedEntity>;
  players: Map<number, ProjectedPlayer>;
  projectiles: Map<number, ProjectedProjectile>;
  fog: Uint8Array;
  contacts: string;
  charted: string;
  smoke: string;
  resultKey: string;
}

function sameQueue(a: QueueItem[] | undefined, b: QueueItem[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (
      left.defId !== right.defId ||
      left.remaining !== right.remaining ||
      left.total !== right.total
    ) {
      return false;
    }
  }
  return true;
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function sameProjectedEntity(a: ProjectedEntity, b: ProjectedEntity): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.defId === b.defId &&
    a.owner === b.owner &&
    a.team === b.team &&
    a.x === b.x &&
    a.z === b.z &&
    a.facing === b.facing &&
    a.turretFacing === b.turretFacing &&
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.state === b.state &&
    a.stance === b.stance &&
    a.buildProgress === b.buildProgress &&
    a.construction === b.construction &&
    a.remembered === b.remembered &&
    a.rallyX === b.rallyX &&
    a.rallyZ === b.rallyZ &&
    a.targetId === b.targetId &&
    a.garrisonId === b.garrisonId &&
    sameIds(a.upgrades, b.upgrades) &&
    sameIds(a.modules, b.modules) &&
    sameCooldowns(a.cooldowns, b.cooldowns) &&
    sameQueue(a.queue, b.queue)
  );
}

/** Reload clocks change continuously, so compare them by value. */
function sameCooldowns(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const left = Object.keys(a ?? {});
  const right = Object.keys(b ?? {});
  if (left.length !== right.length) return false;
  for (const key of left) {
    if (!b || a?.[key] !== b[key]) return false;
  }
  return true;
}

/** Clouds are a small list compared as a whole; ids keep the order stable. */
function smokeKey(smoke: readonly SmokeCloud[]): string {
  return JSON.stringify([...smoke].sort((a, b) => a.id - b.id));
}

function sameProjectile(a: ProjectedProjectile, b: ProjectedProjectile): boolean {
  return (
    a.id === b.id &&
    a.owner === b.owner &&
    a.shooterId === b.shooterId &&
    a.weaponId === b.weaponId &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z
  );
}

function samePlayer(a: ProjectedPlayer, b: ProjectedPlayer): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Result identity excluding the tick, which the delta header already carries.
 * Without this, every 100 ms update would resend the whole result because the
 * tick advances.
 */
export function resultKey(result: ProjectedMatchResult): string {
  return JSON.stringify({
    phase: result.phase,
    winnerTeam: result.winnerTeam,
    reason: result.reason,
    teams: result.teams.map((team) => ({
      team: team.team,
      playerIds: team.playerIds,
      defeated: team.defeated,
      score: team.score,
    })),
  });
}

export function createBaseline(
  state: TeamSnapshot | ProjectedTeamState,
  fog?: Uint8Array,
): SyncBaseline {
  const fogBytes = fog ?? (state.fog ? Uint8Array.from(state.fog) : null);
  if (!fogBytes) throw new Error('A sync baseline requires the full fog array.');
  const entities = new Map<number, ProjectedEntity>();
  for (const entity of state.entities) entities.set(entity.id, entity);
  const players = new Map<number, ProjectedPlayer>();
  for (const player of state.players) players.set(player.id, player);
  const projectiles = new Map<number, ProjectedProjectile>();
  for (const projectile of state.projectiles) projectiles.set(projectile.id, projectile);
  return {
    tick: state.tick,
    entities,
    players,
    projectiles,
    // Always a private copy: the authoritative fog array mutates every tick.
    fog: Uint8Array.from(fogBytes),
    contacts: JSON.stringify(state.contacts),
    charted: JSON.stringify(state.charted),
    smoke: smokeKey(state.smoke),
    resultKey: resultKey(state.result),
  };
}

export function isEmptyChanges(changes: DeltaChanges): boolean {
  return Object.keys(changes).length === 0;
}

/**
 * Build one seat's delta against its baseline. `fog` is the authoritative byte
 * array for that seat's team, so no full fog projection is materialised here.
 */
export function buildDelta(
  baseline: SyncBaseline,
  state: ProjectedTeamState,
  fog: Uint8Array,
): DeltaChanges {
  if (baseline.fog.length !== fog.length) {
    throw new Error('Fog dimensions changed during a room; a full sync is required.');
  }

  const changes: DeltaChanges = {};

  const upsertEntities: ProjectedEntity[] = [];
  const seenEntities = new Set<number>();
  for (const entity of state.entities) {
    seenEntities.add(entity.id);
    const previous = baseline.entities.get(entity.id);
    if (!previous || !sameProjectedEntity(previous, entity)) upsertEntities.push(entity);
  }
  const removeEntities: number[] = [];
  for (const id of baseline.entities.keys()) {
    if (!seenEntities.has(id)) removeEntities.push(id);
  }
  if (upsertEntities.length > 0 || removeEntities.length > 0) {
    changes.entities = {
      upsert: upsertEntities.sort((a, b) => a.id - b.id),
      remove: removeEntities.sort((a, b) => a - b),
    };
  }

  const upsertPlayers: ProjectedPlayer[] = [];
  for (const player of state.players) {
    const previous = baseline.players.get(player.id);
    if (!previous || !samePlayer(previous, player)) upsertPlayers.push(player);
  }
  if (upsertPlayers.length > 0) changes.players = { upsert: upsertPlayers };

  const upsertProjectiles: ProjectedProjectile[] = [];
  const seenProjectiles = new Set<number>();
  for (const projectile of state.projectiles) {
    seenProjectiles.add(projectile.id);
    const previous = baseline.projectiles.get(projectile.id);
    if (!previous || !sameProjectile(previous, projectile)) {
      upsertProjectiles.push(projectile);
    }
  }
  const removeProjectiles: number[] = [];
  for (const id of baseline.projectiles.keys()) {
    if (!seenProjectiles.has(id)) removeProjectiles.push(id);
  }
  if (upsertProjectiles.length > 0 || removeProjectiles.length > 0) {
    changes.projectiles = {
      upsert: upsertProjectiles.sort((a, b) => a.id - b.id),
      remove: removeProjectiles.sort((a, b) => a - b),
    };
  }

  const fogSet: Array<[number, number]> = [];
  for (let index = 0; index < fog.length; index++) {
    if (baseline.fog[index] !== fog[index]) fogSet.push([index, fog[index]]);
  }
  if (fogSet.length > 0) changes.fog = { set: fogSet };

  const contacts = JSON.stringify(state.contacts);
  if (contacts !== baseline.contacts) changes.contacts = state.contacts;

  const charted = JSON.stringify(state.charted);
  if (charted !== baseline.charted) changes.charted = state.charted;

  // A cloud appearing, expiring or being drawn into view is a whole-list change:
  // the list is tiny, and a diff would cost more than it saves.
  const smoke = smokeKey(state.smoke);
  if (smoke !== baseline.smoke) changes.smoke = state.smoke.map((cloud) => ({ ...cloud }));

  if (state.events.length > 0) changes.events = state.events;

  const key = resultKey(state.result);
  if (key !== baseline.resultKey) changes.result = state.result;

  return changes;
}
