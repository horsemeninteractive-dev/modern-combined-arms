/**
 * Save migrations.
 *
 * Version 1 shipped through the nation, fog, garrison and economy phases, so a
 * v1 file can be missing fields that later work added. Version 2 formalises the
 * current schema and the v1 step fills those defaults instead of rejecting the
 * battle. New schema changes add one function per step and never edit an older
 * step, so every historical save keeps a path forward.
 */
import { SAVE_FORMAT_VERSION } from './constants';

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' ? (value as Json) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;
const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Every entity field the current loader and state hash expect. */
function normalizeEntity(raw: unknown): Json {
  const e = asRecord(raw);
  const x = num(e.x, 0);
  const z = num(e.z, 0);
  const hp = num(e.hp, 1);
  const maxHp = num(e.maxHp, hp);
  const facing = num(e.facing, Math.PI / 2);
  return {
    ...e,
    id: num(e.id, 0),
    kind: e.kind === 'building' ? 'building' : 'unit',
    defId: text(e.defId, ''),
    owner: num(e.owner, 0),
    x,
    z,
    hp,
    maxHp,
    facing,
    turretFacing: num(e.turretFacing, facing),
    state: text(e.state, 'idle'),
    order: e.order ?? null,
    path: asArray(e.path),
    pathIndex: num(e.pathIndex, 0),
    cooldown: num(e.cooldown, 0),
    targetId: num(e.targetId, 0),
    ammo: num(e.ammo, 0),
    maxAmmo: num(e.maxAmmo, num(e.ammo, 0)),
    fuel: num(e.fuel, 0),
    maxFuel: num(e.maxFuel, num(e.fuel, 0)),
    stance: text(e.stance, 'aggressive'),
    suppression: num(e.suppression, 0),
    lastHitTick: num(e.lastHitTick, -9999),
    kills: num(e.kills, 0),
    xp: num(e.xp, 0),
    buildProgress: num(e.buildProgress, 1),
    construction: bool(e.construction, false),
    queue: asArray(e.queue),
    rallyX: num(e.rallyX, x),
    rallyZ: num(e.rallyZ, z),
    homeId: num(e.homeId, 0),
    destX: num(e.destX, x),
    destZ: num(e.destZ, z),
    guardX: num(e.guardX, x),
    guardZ: num(e.guardZ, z),
    blockedTicks: num(e.blockedTicks, 0),
    aimTargetId: num(e.aimTargetId, 0),
    captureTargetId: num(e.captureTargetId, 0),
    captureProgress: num(e.captureProgress, 0),
    healTargetId: num(e.healTargetId, 0),
    buildTargetId: num(e.buildTargetId, 0),
    repairTargetId: num(e.repairTargetId, 0),
    garrisonId: num(e.garrisonId, 0),
    aiGroup: num(e.aiGroup, 0),
    aiRole: text(e.aiRole, ''),
  };
}

/** Players written before faction ids were split out kept a nation or side. */
function normalizePlayer(raw: unknown): Json {
  const p = asRecord(raw);
  const team = num(p.team, 0);
  const stats = asRecord(p.stats);
  const income: number[] = asArray(p.incomeHistory)
    .slice(0, 60)
    .map((value) => num(value, 0));
  while (income.length < 60) income.push(0);
  return {
    ...p,
    id: num(p.id, 0),
    name: text(p.name, 'Commander'),
    factionId: nonEmpty(p.factionId) ?? nonEmpty(p.nationId) ?? (team === 0 ? 'lithuania' : 'russia'),
    team,
    isAI: bool(p.isAI, team !== 0),
    mats: num(p.mats, 0),
    req: num(p.req, 0),
    stats: {
      matsGathered: num(stats.matsGathered, 0),
      unitsBuilt: num(stats.unitsBuilt, 0),
      unitsLost: num(stats.unitsLost, 0),
      kills: num(stats.kills, 0),
      buildingsBuilt: num(stats.buildingsBuilt, 0),
    },
    incomeHistory: income,
    defeated: bool(p.defeated, false),
    relayCount: num(p.relayCount, 0),
  };
}

/**
 * v1 → v2: fill the fields added after the first save format, without changing
 * values that are already present. Runtime map arrays are normalised by the
 * loader, which can rebuild a missing ore field from the embedded scenario.
 */
function migrateV1ToV2(raw: Json): Json {
  const state = asRecord(raw.state);
  return {
    ...raw,
    version: 2,
    localPlayerId: num(raw.localPlayerId, 0),
    state: {
      ...state,
      entities: asArray(state.entities).map(normalizeEntity),
      players: asArray(state.players).map(normalizePlayer),
      projectiles: asArray(state.projectiles),
      events: asArray(state.events),
      contacts: asArray(state.contacts),
      charted: asArray(state.charted),
      ai: asRecord(state.ai),
    },
  };
}

/**
 * v2 → v3: research, unit upgrades and building modules. A v2 battle has no
 * research at all, so the honest default is an empty record — never a grant.
 * Unknown ids are kept here and dropped by the loader, which owns the live
 * content catalogue; the migration itself stays content-free.
 */
function migrateV2ToV3(raw: Json): Json {
  const state = asRecord(raw.state);
  return {
    ...raw,
    version: 3,
    state: {
      ...state,
      players: asArray(state.players).map((entry) => {
        const p = asRecord(entry);
        const research = asRecord(p.research);
        const project = asRecord(research.project);
        const completed = asArray(research.completed).filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        );
        const techId = typeof project.techId === 'string' ? project.techId : '';
        const remaining = num(project.remaining, 0);
        const total = num(project.total, 0);
        return {
          ...p,
          research: {
            completed,
            project: techId && total > 0
              ? {
                  techId,
                  remaining: Math.max(0, Math.min(total, remaining)),
                  total,
                }
              : null,
          },
        };
      }),
      entities: asArray(state.entities).map((entry) => {
        const e = asRecord(entry);
        const next: Json = { ...e };
        for (const key of ['upgrades', 'modules'] as const) {
          if (!Array.isArray(e[key])) {
            delete next[key];
            continue;
          }
          const ids = [...new Set(asArray(e[key]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ))];
          if (ids.length > 0) next[key] = ids;
          else delete next[key];
        }
        return next;
      }),
    },
  };
}

const SAVE_MIGRATIONS: Record<number, (data: Json) => Json> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

/**
 * Upgrade a save to the current schema. Returns null when the file predates
 * the first migration or names a version this build cannot reach; the caller
 * turns that into a SaveFormatError.
 */
export function migrateSave(raw: unknown): Json | null {
  let data = asRecord(raw);
  let version = num(data.version, 0);
  if (version < 1) return null;
  let steps = 0;
  while (version < SAVE_FORMAT_VERSION) {
    const step = SAVE_MIGRATIONS[version];
    if (!step) return null;
    data = step(data);
    version = num(data.version, version + 1);
    if (++steps > 32) return null;
  }
  return version === SAVE_FORMAT_VERSION ? data : null;
}
