/**
 * Presentable player identity: callsign and avatar.
 *
 * The stable identifier is always the account id. A callsign is a label the
 * player may change, so nothing durable (match history, seat ownership, result
 * records) is keyed by it; a match stores the callsign it was played under as a
 * snapshot, which is why renaming never rewrites old records.
 *
 * The signed multiplayer ticket also carries the career rank the player held
 * when the seat was claimed. The room never computes a rank and the browser
 * never supplies one; the account service signs it, so a lobby cannot show a
 * rank its player has not earned.
 *
 * Validation lives here rather than in the router so the account API, the room
 * ticket and the lobby all apply the same rules, and so the rules are testable
 * without a Worker.
 */
import { RANKS } from './ranks';
import { parseFlagComposition, type FlagComposition } from '../identity/flag';
import { cosmeticById } from '../identity/cosmetics';

/** Avatar choices. Fixed emblems, not uploads: no image service in this phase. */
export const AVATARS = Object.freeze([
  { id: 'insignia', label: 'Insignia', glyph: '✦', tint: '#6fb2c9' },
  { id: 'shield', label: 'Shield', glyph: '⬢', tint: '#7fae7a' },
  { id: 'eagle', label: 'Eagle', glyph: '⌁', tint: '#c9a35f' },
  { id: 'anchor', label: 'Anchor', glyph: '⚓', tint: '#6f9ec9' },
  { id: 'bolt', label: 'Bolt', glyph: '⚡', tint: '#c98f5f' },
  { id: 'star', label: 'Star', glyph: '★', tint: '#b98fc9' },
] as const);

export type AvatarId = (typeof AVATARS)[number]['id'];
export const AVATAR_IDS: readonly AvatarId[] = AVATARS.map((avatar) => avatar.id);

export const DEFAULT_AVATAR: AvatarId = 'insignia';
export const MIN_CALLSIGN_LENGTH = 3;
export const MAX_CALLSIGN_LENGTH = 20;
/** One rename per day is enough for a player and useless to an impersonator. */
export const CALLSIGN_CHANGES_PER_DAY = 3;

/**
 * Names that must not appear in a lobby. Reserved words cover the interface and
 * staff claims; the blocklist is deliberately short and blunt rather than a
 * shadow moderation system.
 */
const RESERVED_CALLSIGNS = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'system',
  'server',
  'mca',
  'support',
  'staff',
  'developer',
  'official',
  'commander',
  'unknown',
  'guest',
  'player',
  'narrator',
]);

const BLOCKED_FRAGMENTS = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'rape', 'kkk'];

export interface CallsignProblem {
  code: 'invalid-callsign' | 'callsign-reserved';
  message: string;
}

export interface PlayerIdentity {
  callsign: string;
  avatar: AvatarId;
}

/**
 * Fold a callsign for uniqueness and lookup. Case, whitespace runs and
 * punctuation width are presentation; the folded form is the identity key.
 */
export function callsignKey(callsign: string): string {
  return callsign.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Validate a proposed callsign.
 *
 * Letters, digits, spaces, hyphens and underscores only. No leading or trailing
 * separator, no doubled internal whitespace, no control or combining characters,
 * so the name renders identically in the lobby, the HUD and the service record.
 */
export function validateCallsign(raw: unknown): { ok: true; callsign: string } | ({ ok: false } & CallsignProblem) {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'invalid-callsign', message: 'A callsign is required.' };
  }
  const callsign = raw.trim().replace(/\s+/g, ' ');
  if (callsign.length < MIN_CALLSIGN_LENGTH) {
    return {
      ok: false,
      code: 'invalid-callsign',
      message: `A callsign needs at least ${MIN_CALLSIGN_LENGTH} characters.`,
    };
  }
  if (callsign.length > MAX_CALLSIGN_LENGTH) {
    return {
      ok: false,
      code: 'invalid-callsign',
      message: `A callsign may be at most ${MAX_CALLSIGN_LENGTH} characters.`,
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$/.test(callsign)) {
    return {
      ok: false,
      code: 'invalid-callsign',
      message: 'Use letters, digits, spaces, hyphens or underscores, starting and ending with a letter or digit.',
    };
  }
  if (/[_-]{2,}|\s[_-]|[_-]\s/.test(callsign)) {
    return {
      ok: false,
      code: 'invalid-callsign',
      message: 'Separators cannot repeat or sit next to a space.',
    };
  }
  const key = callsignKey(callsign);
  if (RESERVED_CALLSIGNS.has(key)) {
    return { ok: false, code: 'callsign-reserved', message: 'That callsign is reserved.' };
  }
  const flat = key.replace(/[\s_-]/g, '');
  if (BLOCKED_FRAGMENTS.some((fragment) => flat.includes(fragment))) {
    return { ok: false, code: 'callsign-reserved', message: 'That callsign is not available.' };
  }
  return { ok: true, callsign };
}

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}

export function validateAvatar(raw: unknown): AvatarId | null {
  return isAvatarId(raw) ? raw : null;
}

/**
 * A first callsign for a brand-new account.
 *
 * Derived from random bytes, not from the provider name: an OAuth display name
 * is personal information and may also be refused by the callsign rules, and a
 * predictable scheme would let one player guess another's name.
 */
export function defaultCallsign(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return `Commander-${suffix}`;
}

/** Presentation payload shared by the lobby, the result message and the profile. */
export interface IdentitySnapshot {
  callsign: string;
  avatar: AvatarId;
  /**
   * Career rank id at the moment the seat was claimed. Optional because a v2
   * ticket minted before ranks travelled still carries a valid identity.
   */
  rank?: string;
  /**
   * The command flag equipped when the seat was claimed. Optional because a
   * ticket minted before flags travelled, and a guest, carry none. It is a
   * validated composition, never an image or a URL.
   */
  flag?: FlagComposition;
  /** Equipped profile frame catalogue id, validated against the catalogue. */
  frame?: string;
  /** Equipped profile background catalogue id, validated against the catalogue. */
  background?: string;
}

const RANK_IDS = new Set(RANKS.map((rank) => rank.id));

export function isRankId(value: unknown): value is string {
  return typeof value === 'string' && RANK_IDS.has(value);
}

/**
 * Sanitise an identity arriving from another service (the room Worker).
 *
 * The room received it over a signed ticket, but it is still parsed as
 * untrusted data: a malformed identity becomes a neutral one rather than an
 * exception in the lobby path.
 */
export function identitySnapshot(raw: unknown): IdentitySnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const callsign = validateCallsign(record.callsign);
  const avatar = validateAvatar(record.avatar);
  if (!callsign.ok) return null;
  const rank = isRankId(record.rank) ? record.rank : undefined;
  const flag = parseFlagComposition(record.flag);
  const frame = cosmeticById(typeof record.frame === 'string' ? record.frame : null);
  const background = cosmeticById(
    typeof record.background === 'string' ? record.background : null,
  );
  return {
    callsign: callsign.callsign,
    avatar: avatar ?? DEFAULT_AVATAR,
    ...(rank ? { rank } : {}),
    ...(flag.ok ? { flag: flag.composition } : {}),
    ...(frame?.category === 'frame' ? { frame: frame.id } : {}),
    ...(background?.category === 'background' ? { background: background.id } : {}),
  };
}
