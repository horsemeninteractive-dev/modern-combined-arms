import type {
  ProjectedEntity,
  ProjectedMap,
  ProjectedMatchResult,
  ProjectedPlayer,
  ProjectedProjectile,
  TeamSnapshot,
} from './projection';
import type { ContactRecord, SimEvent, SmokeCloud } from '../sim/types';
import type { OutbreakHudPickup, OutbreakHudState } from '../outbreak/types';
import type { DeltaMessage, SyncMessage } from './protocol';

/**
 * Client-side reconstruction of one seat's team-visible state.
 *
 * The server remains authoritative. This reducer exists so a client can apply
 * the versioned sync/delta stream without trusting it: every message is
 * validated first, a delta that fails any check is rejected in full, and any
 * gap or baseline mismatch requires a full resync instead of a guess.
 *
 * The module deliberately has no runtime imports so the Node soak harness can
 * execute it directly and the staging dev page can be served a transpiled copy.
 */

export type AssemblerReason =
  | 'version'
  | 'room-mismatch'
  | 'team-mismatch'
  | 'epoch-mismatch'
  | 'sequence-gap'
  | 'sequence-duplicate'
  | 'sequence-stale'
  | 'base-mismatch'
  | 'not-ready'
  | 'malformed';

export interface AssemblerAccept {
  ok: true;
  seq: number;
  tick: number;
  kind: 'sync' | 'delta';
  /** True when a delta carried no field at all (header-only keepalive). */
  empty: boolean;
}

export interface AssemblerReject {
  ok: false;
  reason: AssemblerReason;
  detail: string;
  /** Every rejection needs a fresh sync; none of them can be recovered in place. */
  needsResync: true;
}

export type AssemblerResult = AssemblerAccept | AssemblerReject;

export interface AssemblerOptions {
  roomId: string;
  team: number;
  protocolVersion?: number;
}

const MAX_GRID = 512;
const MAX_IDS = 4096;
const MAX_EVENTS = 512;
const MAX_TEXT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isText(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function optionalText(value: unknown, max = MAX_TEXT): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

function fail(reason: AssemblerReason, detail: string): AssemblerReject {
  return { ok: false, reason, detail, needsResync: true };
}

class Reject extends Error {
  readonly reason: AssemblerReason;

  constructor(reason: AssemblerReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

function assert(
  condition: unknown,
  detail: string,
  reason: AssemblerReason = 'malformed',
): asserts condition {
  if (!condition) throw new Reject(reason, detail);
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), `${what} has an unknown field "${key}".`);
  }
}

function validateMap(map: unknown): ProjectedMap {
  assert(isRecord(map), 'Map must be an object.');
  checkKeys(
    map,
    ['width', 'height', 'tileSize', 'terrain', 'elevation', 'ore', 'overlay'],
    'Map',
  );
  const width = map.width;
  const height = map.height;
  assert(isInt(width, 1, MAX_GRID) && isInt(height, 1, MAX_GRID), 'Map dimensions are invalid.');
  assert(isNum(map.tileSize) && map.tileSize > 0 && map.tileSize <= 256, 'Map tile size is invalid.');
  const tiles = width * height;
  // Terrain, elevation and the packed surface layer are byte layers; ore is a
  // 16-bit amount per tile. The layer byte ceiling matches OVERLAY_BYTE_MAX; it
  // is repeated here because this module deliberately has no runtime imports.
  const limits = { terrain: 255, elevation: 255, ore: 65535, overlay: 31 } as const;
  const layers = map.overlay === undefined
    ? (['terrain', 'elevation', 'ore'] as const)
    : (['terrain', 'elevation', 'ore', 'overlay'] as const);
  for (const key of layers) {
    const layer = map[key];
    assert(Array.isArray(layer) && layer.length === tiles, `Map ${key} has the wrong length.`);
    for (const value of layer) {
      assert(isInt(value, 0, limits[key]), `Map ${key} contains an invalid value.`);
    }
  }
  const projected: ProjectedMap = {
    width,
    height,
    tileSize: map.tileSize,
    terrain: map.terrain as number[],
    elevation: map.elevation as number[],
    ore: map.ore as number[],
  };
  // Absent means the sender's build predates the surface layer: the client then
  // paints base terrain exactly as it did before.
  if (map.overlay !== undefined) projected.overlay = map.overlay as number[];
  return projected;
}

function validateQueue(value: unknown): void {
  assert(Array.isArray(value) && value.length <= 32, 'Entity queue is invalid.');
  for (const item of value) {
    assert(isRecord(item), 'Queue item must be an object.');
    checkKeys(item, ['defId', 'remaining', 'total'], 'Queue item');
    assert(isText(item.defId, 64), 'Queue defId is invalid.');
    assert(isNum(item.remaining) && isNum(item.total), 'Queue timing is invalid.');
  }
}

function validateEntity(value: unknown, worldWidth: number, worldHeight: number): ProjectedEntity {
  assert(isRecord(value), 'Entity must be an object.');
  checkKeys(
    value,
    [
      'id', 'kind', 'defId', 'owner', 'team', 'x', 'z', 'facing', 'turretFacing', 'hp', 'maxHp',
      'state', 'stance', 'buildProgress', 'construction', 'remembered', 'queue', 'rallyX',
      'rallyZ', 'targetId', 'garrisonId', 'xp', 'upgrades', 'modules', 'cooldowns', 'effects',
      'deconstruct', 'harvester', 'captureTargetId', 'captureProgress', 'aircraft',
      'navalLanding',
    ],
    'Entity',
  );
  assert(isInt(value.id, 1), 'Entity id is invalid.');
  assert(value.kind === 'unit' || value.kind === 'building', 'Entity kind is invalid.');
  assert(isText(value.defId, 64), 'Entity defId is invalid.');
  // Authored neutral structures use owner -1 and team -1. They are legal only
  // when the projection already decided the recipient can see them.
  assert(isInt(value.owner, -1), 'Entity owner is invalid.');
  assert(isInt(value.team, -1, 1), 'Entity team is invalid.');
  assert(isNum(value.x) && value.x >= -1 && value.x <= worldWidth + 1, 'Entity x is out of bounds.');
  assert(isNum(value.z) && value.z >= -1 && value.z <= worldHeight + 1, 'Entity z is out of bounds.');
  assert(isNum(value.facing) && isNum(value.turretFacing), 'Entity facing is invalid.');
  assert(value.hp === null || isNum(value.hp), 'Entity hp is invalid.');
  assert(value.maxHp === null || isNum(value.maxHp), 'Entity maxHp is invalid.');
  assert(
    (value.state === null || optionalText(value.state, 32)) && optionalText(value.stance, 32),
    'Entity state is invalid.',
  );
  assert(value.buildProgress === null || isNum(value.buildProgress), 'Entity buildProgress is invalid.');
  assert(value.construction === null || typeof value.construction === 'boolean', 'Entity construction is invalid.');
  if (value.deconstruct !== undefined) {
    assert(isRecord(value.deconstruct), 'Entity deconstruct is invalid.');
    checkKeys(value.deconstruct, ['remaining', 'total'], 'Entity deconstruct');
    assert(
      isNum(value.deconstruct.remaining) &&
        value.deconstruct.remaining >= 0 &&
        isNum(value.deconstruct.total) &&
        value.deconstruct.total > 0,
      'Entity deconstruct timing is invalid.',
    );
  }
  assert(value.remembered === undefined || value.remembered === true, 'Entity remembered flag is invalid.');
  if (value.queue !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry a queue.');
    validateQueue(value.queue);
  }
  assert(value.rallyX === undefined || isNum(value.rallyX), 'Entity rallyX is invalid.');
  assert(value.rallyZ === undefined || isNum(value.rallyZ), 'Entity rallyZ is invalid.');
  assert(value.targetId === undefined || isInt(value.targetId, 0), 'Entity targetId is invalid.');
  assert(value.garrisonId === undefined || isInt(value.garrisonId, 0), 'Entity garrisonId is invalid.');
  assert(
    value.xp === undefined || (isNum(value.xp) && value.xp >= 0),
    'Entity veterancy is invalid.',
  );
  for (const key of ['upgrades', 'modules'] as const) {
    const list = value[key];
    if (list === undefined) continue;
    assert(value.remembered === undefined, `A remembered entity must not carry ${key}.`);
    assert(Array.isArray(list) && list.length <= 32, `Entity ${key} is invalid.`);
    for (const id of list) assert(isText(id, 64), `Entity ${key} id is invalid.`);
    assert(new Set(list).size === list.length, `Entity ${key} repeats an id.`);
  }
  if (value.cooldowns !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry cooldowns.');
    assert(isRecord(value.cooldowns), 'Entity cooldowns are invalid.');
    const entries = Object.entries(value.cooldowns);
    assert(entries.length <= 16, 'Entity has too many cooldowns.');
    for (const [id, remaining] of entries) {
      assert(isText(id, 64), 'Cooldown ability id is invalid.');
      assert(isNum(remaining) && remaining > 0, 'Cooldown remaining time is invalid.');
    }
  }
  if (value.effects !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry active effects.');
    assert(isRecord(value.effects), 'Entity active effects are invalid.');
    const entries = Object.entries(value.effects);
    assert(entries.length <= 8, 'Entity has too many active effects.');
    for (const [id, remaining] of entries) {
      assert(isText(id, 64), 'Active effect id is invalid.');
      assert(isNum(remaining) && remaining > 0 && remaining <= 60, 'Active effect time is invalid.');
    }
  }
  if (value.harvester !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry mining state.');
    assert(isRecord(value.harvester), 'Entity harvester state is invalid.');
    checkKeys(value.harvester, ['phase', 'ore', 'oreTileX', 'oreTileZ'], 'Entity harvester');
    assert(
      HARVESTER_PHASES.includes(value.harvester.phase as string),
      'Entity harvester phase is invalid.',
    );
    assert(
      isNum(value.harvester.ore) && value.harvester.ore >= 0 && value.harvester.ore <= 10_000,
      'Entity harvester cargo is invalid.',
    );
    for (const key of ['oreTileX', 'oreTileZ'] as const) {
      assert(isInt(value.harvester[key], -1), `Entity harvester ${key} is invalid.`);
    }
  }
  if (value.aircraft !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry airframe state.');
    assert(isRecord(value.aircraft), 'Entity aircraft state is invalid.');
    checkKeys(
      value.aircraft,
      ['landed', 'returningHome', 'climb', 'fieldLanding'],
      'Entity aircraft',
    );
    assert(typeof value.aircraft.landed === 'boolean', 'Entity aircraft landed flag is invalid.');
    assert(
      typeof value.aircraft.returningHome === 'boolean',
      'Entity aircraft returning flag is invalid.',
    );
    assert(
      value.aircraft.climb === undefined ||
        (isNum(value.aircraft.climb) && value.aircraft.climb >= 0 && value.aircraft.climb <= 1),
      'Entity aircraft climb is invalid.',
    );
    if (value.aircraft.fieldLanding !== undefined) {
      const landing = value.aircraft.fieldLanding;
      assert(isRecord(landing), 'Entity field landing is invalid.');
      checkKeys(landing, ['x', 'z', 'purpose'], 'Entity field landing');
      assert(
        isNum(landing.x) && landing.x >= 0 && landing.x <= worldWidth,
        'Entity field landing x is invalid.',
      );
      assert(
        isNum(landing.z) && landing.z >= 0 && landing.z <= worldHeight,
        'Entity field landing z is invalid.',
      );
      assert(
        landing.purpose === 'board' || landing.purpose === 'unload' || landing.purpose === 'idle',
        'Entity field landing purpose is invalid.',
      );
    }
  }
  if (value.navalLanding !== undefined) {
    assert(value.remembered === undefined, 'A remembered entity must not carry landing state.');
    assert(isRecord(value.navalLanding), 'Entity naval landing state is invalid.');
    checkKeys(value.navalLanding, ['x', 'z', 'purpose', 'beached'], 'Entity naval landing');
    assert(
      isNum(value.navalLanding.x) &&
        value.navalLanding.x >= 0 &&
        value.navalLanding.x <= worldWidth,
      'Entity naval landing x is invalid.',
    );
    assert(
      isNum(value.navalLanding.z) &&
        value.navalLanding.z >= 0 &&
        value.navalLanding.z <= worldHeight,
      'Entity naval landing z is invalid.',
    );
    assert(
      value.navalLanding.purpose === 'board' ||
        value.navalLanding.purpose === 'unload' ||
        value.navalLanding.purpose === 'idle',
      'Entity naval landing purpose is invalid.',
    );
    assert(
      typeof value.navalLanding.beached === 'boolean',
      'Entity naval landing beached flag is invalid.',
    );
  }
  assert(
    value.captureTargetId === undefined || isInt(value.captureTargetId, 1),
    'Entity capture target is invalid.',
  );
  assert(
    value.captureProgress === undefined ||
      (isNum(value.captureProgress) && value.captureProgress >= 0 && value.captureProgress <= 1),
    'Entity capture progress is invalid.',
  );
  if (value.remembered === true) {
    assert(value.hp === null && value.maxHp === null, 'A remembered entity must not carry live hp.');
    assert(value.state === null && value.buildProgress === null, 'A remembered entity must not carry live state.');
    assert(value.deconstruct === undefined, 'A remembered entity must not carry a sale.');
  }
  return value as unknown as ProjectedEntity;
}

/**
 * Smoke clouds are visual and authoritative: the recipient validates the same
 * geometry the server resolved, so no peer can draw a screen it cannot have.
 */
function validateSmoke(value: unknown, worldWidth: number, worldHeight: number): SmokeCloud[] {
  assert(Array.isArray(value) && value.length <= 64, 'Smoke list is invalid.');
  const clouds: SmokeCloud[] = [];
  for (const raw of value) {
    assert(isRecord(raw), 'Smoke cloud must be an object.');
    checkKeys(
      raw,
      ['id', 'owner', 'team', 'x', 'z', 'radius', 'startTick', 'expiresTick'],
      'Smoke cloud',
    );
    assert(isInt(raw.id, 1), 'Smoke cloud id is invalid.');
    assert(isInt(raw.owner, -1), 'Smoke cloud owner is invalid.');
    assert(isInt(raw.team, -1, 1), 'Smoke cloud team is invalid.');
    assert(isNum(raw.x) && raw.x >= -1 && raw.x <= worldWidth + 1, 'Smoke cloud x is out of bounds.');
    assert(isNum(raw.z) && raw.z >= -1 && raw.z <= worldHeight + 1, 'Smoke cloud z is out of bounds.');
    assert(isNum(raw.radius) && raw.radius > 0 && raw.radius <= worldWidth, 'Smoke radius is invalid.');
    assert(isInt(raw.startTick, 0), 'Smoke start tick is invalid.');
    assert(isInt(raw.expiresTick, 0) && raw.expiresTick > raw.startTick, 'Smoke expiry is invalid.');
    clouds.push({
      id: raw.id,
      owner: raw.owner,
      team: raw.team,
      x: raw.x,
      z: raw.z,
      radius: raw.radius,
      startTick: raw.startTick,
      expiresTick: raw.expiresTick,
    });
  }
  assert(new Set(clouds.map((cloud) => cloud.id)).size === clouds.length, 'Smoke repeats a cloud id.');
  return clouds.sort((a, b) => a.id - b.id);
}

function validateResearch(value: unknown): void {
  assert(isRecord(value), 'Player research is invalid.');
  checkKeys(value, ['completed', 'project'], 'Player research');
  assert(Array.isArray(value.completed) && value.completed.length <= 64, 'Completed research is invalid.');
  for (const id of value.completed) assert(isText(id, 64), 'Completed technology id is invalid.');
  assert(new Set(value.completed).size === value.completed.length, 'Completed research repeats an id.');
  if (value.project === null) return;
  assert(isRecord(value.project), 'Research project is invalid.');
  checkKeys(value.project, ['techId', 'remaining', 'total'], 'Research project');
  assert(isText(value.project.techId, 64), 'Research project technology is invalid.');
  assert(isNum(value.project.remaining) && value.project.remaining >= 0, 'Research progress is invalid.');
  assert(isNum(value.project.total) && value.project.total > 0, 'Research duration is invalid.');
  assert(value.project.remaining <= value.project.total, 'Research progress exceeds its duration.');
}

function validatePlayer(value: unknown): ProjectedPlayer {
  assert(isRecord(value), 'Player must be an object.');
  checkKeys(
    value,
    [
      'id',
      'name',
      'factionId',
      'team',
      'mats',
      'req',
      'stats',
      'defeated',
      'relayCount',
      'research',
      'superweapon',
    ],
    'Player',
  );
  if (value.research !== undefined) validateResearch(value.research);
  if (value.superweapon !== undefined) {
    assert(isRecord(value.superweapon), 'Player superweapon state is invalid.');
  }
  assert(isInt(value.id, 0), 'Player id is invalid.');
  assert(isText(value.name, 80), 'Player name is invalid.');
  assert(isText(value.factionId, 64), 'Player faction is invalid.');
  assert(value.team === 0 || value.team === 1, 'Player team is invalid.');
  assert(isNum(value.mats) && isNum(value.req), 'Player resources are invalid.');
  assert(isRecord(value.stats), 'Player stats are invalid.');
  assert(typeof value.defeated === 'boolean', 'Player defeated flag is invalid.');
  assert(isInt(value.relayCount, 0), 'Player relay count is invalid.');
  return value as unknown as ProjectedPlayer;
}

function validateProjectile(value: unknown): ProjectedProjectile {
  assert(isRecord(value), 'Projectile must be an object.');
  checkKeys(value, ['id', 'owner', 'shooterId', 'weaponId', 'kind', 'x', 'y', 'z'], 'Projectile');
  assert(isInt(value.id, 1), 'Projectile id is invalid.');
  assert(isInt(value.owner, 0), 'Projectile owner is invalid.');
  assert(isInt(value.shooterId, 0), 'Projectile shooter is invalid.');
  assert(isText(value.weaponId, 64), 'Projectile weapon is invalid.');
  assert(isText(value.kind, 32), 'Projectile kind is invalid.');
  assert(isNum(value.x) && isNum(value.y) && isNum(value.z), 'Projectile position is invalid.');
  return value as unknown as ProjectedProjectile;
}

function validateEvent(value: unknown): SimEvent {
  assert(isRecord(value), 'Event must be an object.');
  assert(isNum(value.tick), 'Event tick is invalid.');
  assert(isNum(value.seq), 'Event sequence is invalid.');
  assert(isInt(value.team, 0, 1), 'Event team is invalid.');
  assert(optionalText(value.text), 'Event text is invalid.');
  assert(value.x === undefined || isNum(value.x), 'Event x is invalid.');
  assert(value.z === undefined || isNum(value.z), 'Event z is invalid.');
  assert(value.entityId === undefined || isInt(value.entityId, 1), 'Event entity id is invalid.');
  assert(value.targetId === undefined || isInt(value.targetId, 1), 'Event target id is invalid.');
  return value as unknown as SimEvent;
}

const HARVESTER_PHASES = ['seek', 'toOre', 'mining', 'toRefinery', 'unloading'];

const CONTACT_STATES = ['confirmed', 'detected', 'last-known'];
const CONTACT_BANDS = ['infantry', 'armour', 'air', 'naval', 'structure'];

function validateContact(value: unknown): ContactRecord {
  assert(isRecord(value), 'Contact must be an object.');
  checkKeys(
    value,
    ['team', 'entityId', 'x', 'z', 'tick', 'defId', 'kind', 'state', 'band'],
    'Contact',
  );
  assert(isInt(value.team, 0, 1), 'Contact team is invalid.');
  assert(isInt(value.entityId, 1), 'Contact entity id is invalid.');
  assert(isNum(value.x) && isNum(value.z), 'Contact position is invalid.');
  assert(isInt(value.tick, 0), 'Contact tick is invalid.');
  // Classification is only present while the contact is confirmed, so a
  // detected or last-known record legitimately carries no definition at all.
  assert(value.defId === undefined || isText(value.defId, 64), 'Contact defId is invalid.');
  assert(value.kind === undefined || isText(value.kind, 32), 'Contact kind is invalid.');
  assert(
    value.state === undefined || CONTACT_STATES.includes(value.state as string),
    'Contact state is invalid.',
  );
  assert(
    value.band === undefined || CONTACT_BANDS.includes(value.band as string),
    'Contact band is invalid.',
  );
  return value as unknown as ContactRecord;
}

function validateResult(value: unknown): ProjectedMatchResult {
  assert(isRecord(value), 'Result must be an object.');
  checkKeys(value, ['phase', 'winnerTeam', 'reason', 'teams', 'tick'], 'Result');
  assert(value.phase === 'playing' || value.phase === 'finished', 'Result phase is invalid.');
  assert(value.winnerTeam === null || value.winnerTeam === 0 || value.winnerTeam === 1, 'Result winner is invalid.');
  assert(value.reason === null || optionalText(value.reason, 40), 'Result reason is invalid.');
  assert(isInt(value.tick, 0), 'Result tick is invalid.');
  assert(Array.isArray(value.teams) && value.teams.length === 2, 'Result teams are invalid.');
  for (const team of value.teams) {
    assert(isRecord(team), 'Result team must be an object.');
    checkKeys(team, ['team', 'playerIds', 'defeated', 'score'], 'Result team');
    assert(team.team === 0 || team.team === 1, 'Result team id is invalid.');
    assert(Array.isArray(team.playerIds) && team.playerIds.length <= 8, 'Result playerIds are invalid.');
    for (const id of team.playerIds) assert(isInt(id, 0), 'Result player id is invalid.');
    assert(typeof team.defeated === 'boolean', 'Result defeated flag is invalid.');
    assert(team.score === null || isNum(team.score), 'Result score is invalid.');
  }
  return value as unknown as ProjectedMatchResult;
}

const OUTBREAK_PHASES: readonly string[] = ['preparation', 'warning', 'assault', 'cleanup', 'complete'];
const OUTBREAK_DIFFICULTIES: readonly string[] = ['easy', 'normal', 'hard', 'nightmare'];
const OUTBREAK_DROP_KINDS: readonly string[] = ['mats', 'req', 'veterancy', 'speed'];
const ZOMBIE_KIND_IDS: readonly string[] = [
  'shambler',
  'runner',
  'brute',
  'bloater',
  'crawler',
  'flyer',
];

/** The survival readout an Outbreak room publishes. Presentation only. */
function validateOutbreak(value: unknown): OutbreakHudState {
  assert(isRecord(value), 'Outbreak state must be an object.');
  checkKeys(
    value,
    [
      'wave',
      'phase',
      'secondsToAssault',
      'unspawned',
      'aliveInfected',
      'prepSeconds',
      'wavesCompleted',
      'zombiesKilled',
      'killsByKind',
      'structuresLost',
      'unitsLost',
      'matsGathered',
      'durationSeconds',
      'difficulty',
      'mode',
      'players',
      'nations',
      'pickups',
    ],
    'Outbreak state',
  );
  assert(isInt(value.wave, 0, 1_000_000), 'Outbreak wave is invalid.');
  assert(
    typeof value.phase === 'string' && OUTBREAK_PHASES.includes(value.phase),
    'Outbreak phase is invalid.',
  );
  assert(isInt(value.secondsToAssault, 0, 86_400), 'Outbreak assault clock is invalid.');
  assert(isInt(value.unspawned, 0, 1_000_000), 'Outbreak unspawned count is invalid.');
  assert(isInt(value.aliveInfected, 0, 1_000_000), 'Outbreak hostile count is invalid.');
  assert(isInt(value.prepSeconds, 0, 86_400), 'Outbreak prep window is invalid.');
  assert(isInt(value.wavesCompleted, 0, 1_000_000), 'Outbreak held-wave count is invalid.');
  assert(isInt(value.zombiesKilled, 0, 10_000_000), 'Outbreak kill count is invalid.');
  assert(isRecord(value.killsByKind), 'Outbreak kill breakdown is invalid.');
  checkKeys(value.killsByKind, ZOMBIE_KIND_IDS, 'Outbreak kill breakdown');
  for (const kind of ZOMBIE_KIND_IDS) {
    assert(isInt(value.killsByKind[kind], 0, 10_000_000), 'Outbreak kill breakdown is invalid.');
  }
  assert(isInt(value.structuresLost, 0, 1_000_000), 'Outbreak structure losses are invalid.');
  assert(isInt(value.unitsLost, 0, 1_000_000), 'Outbreak unit losses are invalid.');
  assert(isInt(value.matsGathered, 0, 10_000_000), 'Outbreak gathered resources are invalid.');
  assert(isInt(value.durationSeconds, 0, 86_400_000), 'Outbreak duration is invalid.');
  assert(
    typeof value.difficulty === 'string' && OUTBREAK_DIFFICULTIES.includes(value.difficulty),
    'Outbreak difficulty is invalid.',
  );
  assert(value.mode === 'solo' || value.mode === 'coop', 'Outbreak mode is invalid.');
  assert(isInt(value.players, 1, 4), 'Outbreak commander count is invalid.');
  assert(Array.isArray(value.nations) && value.nations.length <= 4, 'Outbreak nations are invalid.');
  for (const nation of value.nations) assert(optionalText(nation, 32), 'Outbreak nation is invalid.');
  const kinds = value.killsByKind as Record<string, number>;
  // Drops are optional on the wire: a skirmish projection never carries the
  // block, and a room built before drops existed publishes none either. When
  // they are present every coordinate and kind is checked, because a client
  // draws crates from this list and nothing else.
  let pickups: OutbreakHudPickup[] | undefined;
  if (value.pickups !== undefined) {
    assert(Array.isArray(value.pickups) && value.pickups.length <= 64, 'Outbreak drops are invalid.');
    pickups = value.pickups.map((entry) => {
      assert(isRecord(entry), 'Outbreak drop must be an object.');
      checkKeys(entry, ['id', 'kind', 'x', 'z'], 'Outbreak drop');
      assert(isInt(entry.id, 1, 1_000_000_000), 'Outbreak drop id is invalid.');
      assert(
        typeof entry.kind === 'string' && OUTBREAK_DROP_KINDS.includes(entry.kind),
        'Outbreak drop kind is invalid.',
      );
      assert(isNum(entry.x) && isNum(entry.z), 'Outbreak drop position is invalid.');
      return {
        id: entry.id as number,
        kind: entry.kind as OutbreakHudPickup['kind'],
        x: entry.x as number,
        z: entry.z as number,
      };
    });
    assert(
      new Set(pickups.map((pickup) => pickup.id)).size === pickups.length,
      'Outbreak drops repeat an id.',
    );
  }
  return {
    wave: value.wave as number,
    phase: value.phase as OutbreakHudState['phase'],
    secondsToAssault: value.secondsToAssault as number,
    unspawned: value.unspawned as number,
    aliveInfected: value.aliveInfected as number,
    prepSeconds: value.prepSeconds as number,
    wavesCompleted: value.wavesCompleted as number,
    zombiesKilled: value.zombiesKilled as number,
    killsByKind: {
      shambler: kinds.shambler,
      runner: kinds.runner,
      brute: kinds.brute,
      bloater: kinds.bloater,
      crawler: kinds.crawler,
      flyer: kinds.flyer,
    },
    structuresLost: value.structuresLost as number,
    unitsLost: value.unitsLost as number,
    matsGathered: value.matsGathered as number,
    durationSeconds: value.durationSeconds as number,
    difficulty: value.difficulty as OutbreakHudState['difficulty'],
    mode: value.mode as OutbreakHudState['mode'],
    players: value.players as number,
    nations: (value.nations as unknown[]).slice() as string[],
    ...(pickups ? { pickups } : {}),
  };
}

function validateFogSet(value: unknown, tiles: number): Array<[number, number]> {
  assert(isRecord(value), 'Fog delta must be an object.');
  checkKeys(value, ['set'], 'Fog delta');
  assert(Array.isArray(value.set) && value.set.length <= tiles, 'Fog delta set is invalid.');
  const seen = new Set<number>();
  for (const entry of value.set) {
    assert(Array.isArray(entry) && entry.length === 2, 'Fog delta entry is invalid.');
    const [index, level] = entry as unknown[];
    assert(isInt(index, 0, tiles - 1), 'Fog delta index is out of range.');
    assert(level === 0 || level === 1 || level === 2, 'Fog delta value is invalid.');
    assert(!seen.has(index as number), 'Fog delta repeats a tile.');
    seen.add(index as number);
  }
  return value.set as Array<[number, number]>;
}

/**
 * One recipient's reducer. Construction is per socket and per seat; reconnect
 * creates a new instance and therefore a new expected epoch.
 */
export class SnapshotAssembler {
  private readonly roomId: string;
  private readonly team: number;
  private readonly protocolVersion: number;

  private current: TeamSnapshot | null = null;
  private currentEpoch = 0;
  private currentSeq = 0;
  private currentTick = 0;

  constructor(options: AssemblerOptions) {
    this.roomId = options.roomId;
    this.team = options.team;
    this.protocolVersion = options.protocolVersion ?? 2;
  }

  get ready(): boolean {
    return this.current !== null;
  }

  get epoch(): number {
    return this.currentEpoch;
  }

  get seq(): number {
    return this.currentSeq;
  }

  get tick(): number {
    return this.currentTick;
  }

  get teamId(): number {
    return this.team;
  }

  /** The reconstructed view. Callers must treat it as read-only. */
  state(): TeamSnapshot | null {
    return this.current;
  }

  apply(message: unknown): AssemblerResult {
    try {
      return this.applyUnchecked(message);
    } catch (error) {
      if (error instanceof Reject) return fail(error.reason, error.message);
      return fail('malformed', error instanceof Error ? error.message : 'Unrecognised message.');
    }
  }

  private applyUnchecked(message: unknown): AssemblerResult {
    assert(isRecord(message), 'Message must be an object.');
    assert(message.v === this.protocolVersion, 'Unsupported protocol version.', 'version');
    assert(typeof message.type === 'string', 'Message type is missing.');
    if (message.type === 'sync') return this.applySync(message as unknown as SyncMessage);
    if (message.type === 'delta') return this.applyDelta(message as unknown as DeltaMessage);
    return fail('malformed', `Unsupported message type "${message.type}".`);
  }

  private applySync(message: SyncMessage): AssemblerResult {
    checkKeys(
      message as unknown as Record<string, unknown>,
      ['type', 'v', 'epoch', 'seq', 'tick', 'team', 'roomId', 'checkpoint', 'state'],
      'Sync',
    );
    assert(message.roomId === this.roomId, 'Sync belongs to another room.', 'room-mismatch');
    assert(message.team === this.team, 'Sync belongs to another team.', 'team-mismatch');
    assert(isInt(message.epoch, 1, 0x7fffffff), 'Sync epoch is invalid.');
    assert(isInt(message.seq, 1, 0x7fffffff), 'Sync sequence is invalid.');
    assert(typeof message.checkpoint === 'boolean', 'Sync checkpoint flag is invalid.');
    assert(isInt(message.tick, 0), 'Sync tick is invalid.');
    if (this.current !== null) {
      assert(message.epoch > this.currentEpoch, 'Sync epoch did not advance.', 'epoch-mismatch');
    }

    const state = message.state as unknown as Record<string, unknown>;
    assert(isRecord(state), 'Sync state must be an object.');
    checkKeys(
      state,
      [
        'type', 'v', 'protocol', 'tick', 'team', 'map', 'fog', 'contacts', 'charted',
        'smoke', 'players', 'entities', 'projectiles', 'events', 'result', 'outbreak',
      ],
      'Sync state',
    );
    assert(state.type === 'snapshot', 'Sync state type is invalid.');
    assert(state.v === this.protocolVersion, 'Sync state version is invalid.', 'version');
    assert(state.protocol === this.protocolVersion, 'Sync state protocol is invalid.', 'version');
    assert(state.team === this.team, 'Sync state team is invalid.', 'team-mismatch');
    assert(isInt(state.tick, 0), 'Sync state tick is invalid.');

    // A periodic checkpoint omits the immutable map. It is valid only after a
    // verified baseline; a fresh or reconnecting client must receive the map.
    const map = state.map === undefined ? this.current?.map : validateMap(state.map);
    assert(map, 'No verified static map for this sync.', 'not-ready');
    const tiles = map.width * map.height;
    assert(Array.isArray(state.fog) && state.fog.length === tiles, 'Sync fog has the wrong length.');
    for (const value of state.fog) assert(value === 0 || value === 1 || value === 2, 'Sync fog value is invalid.');

    assert(Array.isArray(state.contacts) && state.contacts.length <= MAX_IDS, 'Sync contacts are invalid.');
    const contacts = state.contacts.map((contact) => validateContact(contact));
    assert(Array.isArray(state.charted) && state.charted.length <= MAX_IDS, 'Sync charted is invalid.');
    for (const id of state.charted) assert(isInt(id, 1), 'Sync charted id is invalid.');
    assert(Array.isArray(state.players) && state.players.length <= 8, 'Sync players are invalid.');
    const players = state.players.map((player) => validatePlayer(player));
    assert(Array.isArray(state.entities) && state.entities.length <= MAX_IDS, 'Sync entities are invalid.');
    const entities = state.entities.map((entity) =>
      validateEntity(entity, map.width * map.tileSize, map.height * map.tileSize),
    );
    assert(new Set(entities.map((entity) => entity.id)).size === entities.length, 'Sync repeats an entity id.');
    // A build that predates smoke simply sends none.
    const smoke = state.smoke === undefined
      ? []
      : validateSmoke(state.smoke, map.width * map.tileSize, map.height * map.tileSize);
    assert(Array.isArray(state.projectiles) && state.projectiles.length <= MAX_IDS, 'Sync projectiles are invalid.');
    const projectiles = state.projectiles.map((projectile) => validateProjectile(projectile));
    assert(
      new Set(projectiles.map((projectile) => projectile.id)).size === projectiles.length,
      'Sync repeats a projectile id.',
    );
    assert(Array.isArray(state.events) && state.events.length <= MAX_EVENTS, 'Sync events are invalid.');
    const events = state.events.map((event) => validateEvent(event));
    const result = validateResult(state.result);
    const outbreak = state.outbreak === undefined ? undefined : validateOutbreak(state.outbreak);

    const next: TeamSnapshot = {
      type: 'snapshot',
      v: this.protocolVersion as 2,
      protocol: this.protocolVersion as 2,
      tick: state.tick as number,
      team: this.team,
      map,
      fog: (state.fog as number[]).slice(),
      contacts,
      charted: (state.charted as number[]).slice(),
      players,
      entities,
      smoke,
      projectiles,
      events,
      result,
      ...(outbreak ? { outbreak } : {}),
    };
    this.current = next;
    this.currentEpoch = message.epoch;
    this.currentSeq = message.seq;
    this.currentTick = state.tick as number;
    return { ok: true, kind: 'sync', seq: message.seq, tick: this.currentTick, empty: false };
  }

  private applyDelta(message: DeltaMessage): AssemblerResult {
    checkKeys(
      message as unknown as Record<string, unknown>,
      ['type', 'v', 'epoch', 'seq', 'base', 'tick', 'team', 'roomId', 'changes'],
      'Delta',
    );
    assert(message.roomId === this.roomId, 'Delta belongs to another room.', 'room-mismatch');
    assert(message.team === this.team, 'Delta belongs to another team.', 'team-mismatch');
    assert(this.current !== null, 'No verified baseline for this delta.', 'not-ready');
    assert(message.epoch === this.currentEpoch, 'Delta belongs to another sync generation.', 'epoch-mismatch');
    assert(isInt(message.seq, 1, 0x7fffffff), 'Delta sequence is invalid.');
    assert(isInt(message.base, 0, 0x7fffffff), 'Delta base is invalid.');
    if (message.seq === this.currentSeq) {
      return fail('sequence-duplicate', `Delta sequence ${message.seq} was already applied.`);
    }
    if (message.seq < this.currentSeq) {
      return fail('sequence-stale', `Delta sequence ${message.seq} is older than ${this.currentSeq}.`);
    }
    if (message.base !== this.currentSeq) {
      return fail('base-mismatch', `Delta base ${message.base} is not the applied sequence ${this.currentSeq}.`);
    }
    if (message.seq !== this.currentSeq + 1) {
      return fail('sequence-gap', `Expected sequence ${this.currentSeq + 1}, received ${message.seq}.`);
    }
    assert(isInt(message.tick, 0), 'Delta tick is invalid.');

    const changes = message.changes as unknown as Record<string, unknown>;
    assert(isRecord(changes), 'Delta changes must be an object.');
    checkKeys(
      changes,
      ['fog', 'contacts', 'charted', 'smoke', 'players', 'entities', 'projectiles', 'events', 'result', 'outbreak'],
      'Delta changes',
    );

    const current = this.current as TeamSnapshot;
    const tiles = current.map.width * current.map.height;
    const worldWidth = current.map.width * current.map.tileSize;
    const worldHeight = current.map.height * current.map.tileSize;

    // Validate the whole delta before touching the baseline.
    const fogSet = changes.fog === undefined ? null : validateFogSet(changes.fog, tiles);

    let contacts: ContactRecord[] | null = null;
    if (changes.contacts !== undefined) {
      assert(Array.isArray(changes.contacts) && changes.contacts.length <= MAX_IDS, 'Delta contacts are invalid.');
      contacts = changes.contacts.map((contact) => validateContact(contact));
    }
    let charted: number[] | null = null;
    if (changes.charted !== undefined) {
      assert(Array.isArray(changes.charted) && changes.charted.length <= MAX_IDS, 'Delta charted is invalid.');
      for (const id of changes.charted) assert(isInt(id, 1), 'Delta charted id is invalid.');
      charted = (changes.charted as number[]).slice();
    }
    const smoke =
      changes.smoke === undefined
        ? null
        : validateSmoke(changes.smoke, worldWidth, worldHeight);
    let players: ProjectedPlayer[] | null = null;
    if (changes.players !== undefined) {
      const block = changes.players as unknown as Record<string, unknown>;
      assert(isRecord(block), 'Delta players must be an object.');
      checkKeys(block, ['upsert'], 'Delta players');
      assert(Array.isArray(block.upsert) && block.upsert.length <= 8, 'Delta player upsert is invalid.');
      players = block.upsert.map((player) => validatePlayer(player));
    }
    const entityUpserts: ProjectedEntity[] = [];
    const entityRemovals: number[] = [];
    if (changes.entities !== undefined) {
      const block = changes.entities as unknown as Record<string, unknown>;
      assert(isRecord(block), 'Delta entities must be an object.');
      checkKeys(block, ['upsert', 'remove'], 'Delta entities');
      assert(Array.isArray(block.upsert) && block.upsert.length <= MAX_IDS, 'Delta entity upsert is invalid.');
      for (const entity of block.upsert) {
        entityUpserts.push(validateEntity(entity, worldWidth, worldHeight));
      }
      assert(Array.isArray(block.remove) && block.remove.length <= MAX_IDS, 'Delta entity removal is invalid.');
      for (const id of block.remove) {
        assert(isInt(id, 1), 'Delta entity removal id is invalid.');
        entityRemovals.push(id);
      }
      const upsertIds = new Set(entityUpserts.map((entity) => entity.id));
      assert(
        new Set(entityUpserts.map((entity) => entity.id)).size === entityUpserts.length,
        'Delta repeats an entity upsert.',
      );
      assert(new Set(entityRemovals).size === entityRemovals.length, 'Delta repeats an entity removal.');
      for (const id of entityRemovals) assert(!upsertIds.has(id), 'Delta upserts and removes the same entity.');
    }
    const projectileUpserts: ProjectedProjectile[] = [];
    const projectileRemovals: number[] = [];
    if (changes.projectiles !== undefined) {
      const block = changes.projectiles as unknown as Record<string, unknown>;
      assert(isRecord(block), 'Delta projectiles must be an object.');
      checkKeys(block, ['upsert', 'remove'], 'Delta projectiles');
      assert(Array.isArray(block.upsert) && block.upsert.length <= MAX_IDS, 'Delta projectile upsert is invalid.');
      for (const projectile of block.upsert) projectileUpserts.push(validateProjectile(projectile));
      assert(
        new Set(projectileUpserts.map((projectile) => projectile.id)).size ===
          projectileUpserts.length,
        'Delta repeats a projectile upsert.',
      );
      assert(Array.isArray(block.remove) && block.remove.length <= MAX_IDS, 'Delta projectile removal is invalid.');
      for (const id of block.remove) {
        assert(isInt(id, 1), 'Delta projectile removal id is invalid.');
        projectileRemovals.push(id);
      }
      const upsertIds = new Set(projectileUpserts.map((projectile) => projectile.id));
      for (const id of projectileRemovals) assert(!upsertIds.has(id), 'Delta upserts and removes the same projectile.');
    }
    let events: SimEvent[] | null = null;
    if (changes.events !== undefined) {
      assert(Array.isArray(changes.events) && changes.events.length <= MAX_EVENTS, 'Delta events are invalid.');
      events = changes.events.map((event) => validateEvent(event));
    }
    const result = changes.result === undefined ? null : validateResult(changes.result);
    const outbreak = changes.outbreak === undefined ? null : validateOutbreak(changes.outbreak);

    // Validation passed; apply atomically.
    if (fogSet) {
      for (const [index, level] of fogSet) current.fog[index] = level;
    }
    if (contacts) current.contacts = contacts;
    if (charted) current.charted = charted;
    if (smoke) current.smoke = smoke;
    if (players) {
      for (const player of players) {
        const index = current.players.findIndex((entry) => entry.id === player.id);
        if (index >= 0) current.players[index] = player;
        else current.players.push(player);
      }
    }
    if (entityUpserts.length > 0 || entityRemovals.length > 0) {
      const removed = new Set(entityRemovals);
      const kept = current.entities.filter((entity) => !removed.has(entity.id));
      const byId = new Map(kept.map((entity) => [entity.id, entity]));
      for (const entity of entityUpserts) byId.set(entity.id, entity);
      current.entities = [...byId.values()].sort((a, b) => a.id - b.id);
    }
    if (projectileUpserts.length > 0 || projectileRemovals.length > 0) {
      const removed = new Set(projectileRemovals);
      const kept = current.projectiles.filter((projectile) => !removed.has(projectile.id));
      const byId = new Map(kept.map((projectile) => [projectile.id, projectile]));
      for (const projectile of projectileUpserts) byId.set(projectile.id, projectile);
      current.projectiles = [...byId.values()].sort((a, b) => a.id - b.id);
    }
    if (events && events.length > 0) current.events = [...current.events, ...events].slice(-MAX_EVENTS);
    if (result) current.result = result;
    if (outbreak) current.outbreak = outbreak;
    current.tick = message.tick;
    // The result tick moves with the authoritative tick even when the result
    // identity did not change, exactly as a full projection would report it.
    current.result = { ...current.result, tick: message.tick };

    this.currentSeq = message.seq;
    this.currentTick = message.tick;
    return {
      ok: true,
      kind: 'delta',
      seq: message.seq,
      tick: message.tick,
      empty: Object.keys(changes).length === 0,
    };
  }
}
