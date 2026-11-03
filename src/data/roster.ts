import type { NationRosterModifications, RosterDef } from '../sim/types';
import { BUILDINGS, buildingFamily } from './buildings';
import { ALLIANCE_LIST, ALLIANCES, FACTIONS, NATION_LIST, NATIONS } from './factions';
import { UNITS, unitFamily } from './units';
import { resolveVariantChain } from './variant';

type EntityKind = 'unit' | 'building';

interface ListChanges {
  add?: readonly string[];
  remove?: readonly string[];
  replace?: Readonly<Record<string, string>>;
}

const cache = new Map<string, RosterDef>();

function fail(subject: string, message: string): never {
  throw new Error(`Invalid roster for ${subject}: ${message}`);
}

function isKnown(kind: EntityKind, id: string): boolean {
  return kind === 'unit' ? Object.hasOwn(UNITS, id) : Object.hasOwn(BUILDINGS, id);
}

/**
 * Apply one list of roster changes. The baseline order is preserved; additions
 * append in declaration order. The result is frozen, so callers cannot mutate
 * the canonical registry through a resolved roster.
 */
function applyList(
  base: readonly string[],
  changes: ListChanges,
  kind: EntityKind,
  subject: string,
): readonly string[] {
  const seen = new Set<string>();
  const ordered = base.map((id) => {
    if (typeof id !== 'string' || id.length === 0) fail(subject, `invalid ${kind} id`);
    if (!isKnown(kind, id)) fail(subject, `unknown ${kind} "${id}"`);
    if (seen.has(id)) fail(subject, `duplicate ${kind} "${id}" in the baseline`);
    seen.add(id);
    return id;
  });

  const removals = changes.remove ?? [];
  const removed = new Set<string>();
  for (const id of removals) {
    if (removed.has(id)) fail(subject, `duplicate removal of ${kind} "${id}"`);
    if (!seen.has(id)) fail(subject, `cannot remove ${kind} "${id}": not in the baseline`);
    removed.add(id);
  }

  const replacements = changes.replace ?? {};
  for (const [from, to] of Object.entries(replacements)) {
    if (!seen.has(from)) {
      fail(subject, `replacement source ${kind} "${from}" is not in the baseline`);
    }
    if (removed.has(from)) {
      fail(subject, `${kind} "${from}" is both removed and replaced`);
    }
    if (typeof to !== 'string' || to.length === 0) fail(subject, `invalid replacement ${kind} id`);
    if (!isKnown(kind, to)) fail(subject, `unknown replacement ${kind} "${to}"`);
    if (removed.has(to)) {
      fail(subject, `${kind} "${from}" is replaced by "${to}", which is removed`);
    }
  }

  // Replacement keeps the baseline slot; removals are matched by the original
  // position, not by the replacement id.
  const result = ordered
    .map((id) => replacements[id] ?? id)
    .filter((_, index) => !removed.has(ordered[index]));

  const additions = changes.add ?? [];
  const added = new Set<string>();
  const finalSeen = new Set(result);
  for (const id of additions) {
    if (typeof id !== 'string' || id.length === 0) fail(subject, `invalid added ${kind} id`);
    if (!isKnown(kind, id)) fail(subject, `unknown added ${kind} "${id}"`);
    if (added.has(id)) fail(subject, `duplicate addition of ${kind} "${id}"`);
    if (finalSeen.has(id)) {
      fail(subject, `added ${kind} "${id}" duplicates an existing roster entry`);
    }
    added.add(id);
    finalSeen.add(id);
    result.push(id);
  }

  const unique = new Set<string>();
  for (const id of result) {
    if (unique.has(id)) fail(subject, `duplicate ${kind} "${id}" after roster changes`);
    unique.add(id);
  }
  return Object.freeze(result);
}

/**
 * Resolve an alliance baseline plus national changes into a frozen roster.
 * Exported for integrity tests; gameplay should call `resolveRoster`.
 */
export function mergeRoster(
  base: RosterDef,
  changes: NationRosterModifications = {},
  subject = 'roster',
): RosterDef {
  const units = applyList(
    base.units,
    { add: changes.addUnits, remove: changes.removeUnits, replace: changes.replaceUnits },
    'unit',
    subject,
  );
  const buildings = applyList(
    base.buildings,
    {
      add: changes.addBuildings,
      remove: changes.removeBuildings,
      replace: changes.replaceBuildings,
    },
    'building',
    subject,
  );
  return Object.freeze({ units, buildings });
}

/**
 * Actual roster id for a baseline unit slot. Variants declare `variantOf`, and
 * the chain is followed to its canonical root, so an alliance platform and a
 * national replacement of that platform both answer the canonical slot the
 * production list names. Returns undefined when the roster has no definition in
 * that slot.
 */
export function unitSlotId(roster: RosterDef, slotId: string): string | undefined {
  if (roster.units.includes(slotId)) return slotId;
  const slot = unitFamily(slotId);
  return roster.units.find((id) => unitFamily(id) === slot);
}

/** Actual roster id for a baseline structure slot, resolved through the chain. */
export function buildingSlotId(roster: RosterDef, slotId: string): string | undefined {
  if (roster.buildings.includes(slotId)) return slotId;
  const slot = buildingFamily(slotId);
  return roster.buildings.find((id) => buildingFamily(id) === slot);
}

/**
 * What a facility can produce for this roster, in the baseline slot order.
 * Substitutions resolve to their national variant; a national addition that
 * names this facility in `producedBy` is appended rather than dropped.
 */
export function productionEntries(roster: RosterDef, buildingId: string): string[] {
  const def = BUILDINGS[buildingId];
  if (!def?.productionList) return [];
  const entries: string[] = [];
  // Unit definitions name the canonical facility (`factory`, `airfield`), not a
  // national structure variant. Compare families so a Polish Armoured Workshop
  // still builds everything the Vehicle Factory family produces instead of an
  // empty list, while a structure that is not of that family still refuses.
  const facilitySlot = buildingFamily(buildingId);
  const producesHere = (id: string): boolean =>
    (UNITS[id]?.producedBy ?? []).some((facility) => buildingFamily(facility) === facilitySlot);
  const push = (id: string | undefined): void => {
    if (!id || entries.includes(id)) return;
    if (!roster.units.includes(id)) return;
    if (!producesHere(id)) return;
    entries.push(id);
  };
  for (const slot of def.productionList) push(unitSlotId(roster, slot));
  for (const id of roster.units) {
    if (producesHere(id)) push(id);
  }
  return entries;
}

/**
 * Membership test shared by the simulation's production and construction
 * gates. Kept beside the resolver so the UI and the simulation answer
 * "can this player field this?" with the same rule.
 */
export function rosterIncludes(
  roster: RosterDef,
  kind: 'unit' | 'building',
  id: string,
): boolean {
  return kind === 'unit' ? roster.units.includes(id) : roster.buildings.includes(id);
}

/**
 * Resolve a nation or legacy faction id to its effective roster.
 *
 * Nations inherit their alliance baseline and apply their own additions,
 * exclusions and substitutions. Legacy `baltic`/`expeditionary` presets resolve
 * to their alliance baseline unchanged, so old maps and saves keep working.
 * Results are cached and frozen; repeated calls return the same object.
 */
export function resolveRoster(id: string): RosterDef {
  const cached = cache.get(id);
  if (cached) return cached;

  let roster: RosterDef;
  const nation = Object.hasOwn(NATIONS, id) ? NATIONS[id] : undefined;
  if (nation) {
    const alliance = Object.hasOwn(ALLIANCES, nation.allianceId)
      ? ALLIANCES[nation.allianceId]
      : undefined;
    if (!alliance) {
      fail(`nation "${id}"`, `unknown alliance "${nation.allianceId}"`);
    }
    roster = mergeRoster(alliance.baseline, nation.roster, `nation "${id}"`);
  } else {
    const legacy = Object.hasOwn(FACTIONS, id) ? FACTIONS[id] : undefined;
    if (!legacy) {
      const known = [...Object.keys(NATIONS), ...Object.keys(FACTIONS)].join(', ');
      throw new Error(`Unknown faction or nation "${id}". Known ids: ${known}.`);
    }
    const alliance = Object.hasOwn(ALLIANCES, legacy.allianceId)
      ? ALLIANCES[legacy.allianceId]
      : undefined;
    if (!alliance) {
      fail(`legacy faction "${id}"`, `unknown alliance "${legacy.allianceId}"`);
    }
    roster = mergeRoster(alliance.baseline, {}, `legacy faction "${id}"`);
  }

  cache.set(id, roster);
  return roster;
}

/**
 * Every registered definition's `variantOf` chain must reach a canonical slot.
 * Reports the offending definition and the chain that broke, so a multi-level
 * variant cannot hide a missing target, a self-reference or a cycle until a
 * player fields it. Called from `validateRosterRegistry` at module load.
 */
export function validateVariantChains(): void {
  for (const id of Object.keys(UNITS)) {
    const chain = resolveVariantChain(UNITS, id);
    if (chain.error) fail(`unit "${id}"`, chain.error);
  }
  for (const id of Object.keys(BUILDINGS)) {
    const chain = resolveVariantChain(BUILDINGS, id);
    if (chain.error) fail(`building "${id}"`, chain.error);
  }
}

/**
 * A replacement must occupy the same canonical slot as the definition it
 * replaces. Because the slot is the *root* of the variant chain, a nation may
 * replace an alliance platform (itself a variant of the canonical slot) without
 * escaping the family its production list and prerequisites name.
 */
export function assertSameVariantSlot(
  kind: EntityKind,
  from: string,
  to: string,
  subject = 'roster',
): void {
  const target = (kind === 'unit' ? UNITS : BUILDINGS)[to];
  if (!target) fail(subject, `unknown replacement ${kind} "${to}"`);
  if (!target.variantOf) {
    fail(subject, `${kind} "${to}" must declare variantOf to occupy a slot`);
  }
  const family = kind === 'unit' ? unitFamily : buildingFamily;
  const sourceSlot = family(from);
  const targetSlot = family(to);
  if (targetSlot !== sourceSlot) {
    fail(
      subject,
      `${kind} "${to}" resolves to slot "${targetSlot}", but "${from}" occupies "${sourceSlot}"`,
    );
  }
}

/**
 * A roster may hold at most one definition per canonical slot, or slot
 * resolution would have to guess which of two definitions the production list
 * means. Bases are distinct ids, so this only rejects genuinely ambiguous data.
 */
function assertOneSlotPerFamily(roster: RosterDef, subject: string): void {
  const occupied = new Map<string, string>();
  for (const id of roster.units) {
    const slot = unitFamily(id);
    const taken = occupied.get(slot);
    if (taken !== undefined) {
      fail(subject, `units "${taken}" and "${id}" both occupy slot "${slot}"`);
    }
    occupied.set(slot, id);
  }
  occupied.clear();
  for (const id of roster.buildings) {
    const slot = buildingFamily(id);
    const taken = occupied.get(slot);
    if (taken !== undefined) {
      fail(subject, `buildings "${taken}" and "${id}" both occupy slot "${slot}"`);
    }
    occupied.set(slot, id);
  }
}

/**
 * Fail fast if the shipped registry has an unknown reference, a duplicate id,
 * a bad alliance link or a legacy preset that has drifted from its baseline.
 * Called once at module load; also exported so a test can assert the invariant.
 */
export function validateRosterRegistry(): void {
  validateVariantChains();

  const ids = new Set<string>();
  const register = (kind: string, id: string): void => {
    if (ids.has(id)) throw new Error(`Faction content id "${id}" is used by more than one ${kind}.`);
    ids.add(id);
  };

  // Iterate the authored lists, not the keyed records: a duplicate id would be
  // collapsed by Object.fromEntries before the record could reveal it.
  if (ALLIANCE_LIST.length !== Object.keys(ALLIANCES).length) {
    throw new Error('Alliance content contains a duplicate id.');
  }
  for (const alliance of ALLIANCE_LIST) {
    register('alliance', alliance.id);
    const subject = `alliance "${alliance.id}"`;
    assertOneSlotPerFamily(mergeRoster(alliance.baseline, {}, subject), subject);
  }

  if (NATION_LIST.length !== Object.keys(NATIONS).length) {
    throw new Error('Nation content contains a duplicate id.');
  }
  for (const nation of NATION_LIST) {
    register('nation', nation.id);
    if (!Object.hasOwn(ALLIANCES, nation.allianceId)) {
      fail(`nation "${nation.id}"`, `unknown alliance "${nation.allianceId}"`);
    }
    // A shipped replacement must be the same family as the slot it fills, or
    // the production list would silently point at an unrelated definition.
    for (const [from, to] of Object.entries(nation.roster?.replaceUnits ?? {})) {
      const source = Object.hasOwn(UNITS, from) ? UNITS[from] : undefined;
      const target = Object.hasOwn(UNITS, to) ? UNITS[to] : undefined;
      if (!source) fail(`nation "${nation.id}"`, `unknown replacement source unit "${from}"`);
      if (!target) fail(`nation "${nation.id}"`, `unknown replacement unit "${to}"`);
      assertSameVariantSlot('unit', from, to, `nation "${nation.id}"`);
      if (!source.producedBy.some((facility) => target.producedBy.includes(facility))) {
        fail(
          `nation "${nation.id}"`,
          `unit "${to}" has no production facility in common with "${from}"`,
        );
      }
    }
    for (const [from, to] of Object.entries(nation.roster?.replaceBuildings ?? {})) {
      const target = Object.hasOwn(BUILDINGS, to) ? BUILDINGS[to] : undefined;
      if (!Object.hasOwn(BUILDINGS, from)) {
        fail(`nation "${nation.id}"`, `unknown replacement source building "${from}"`);
      }
      if (!target) fail(`nation "${nation.id}"`, `unknown replacement building "${to}"`);
      assertSameVariantSlot('building', from, to, `nation "${nation.id}"`);
      if (target.authoredOnly) {
        fail(`nation "${nation.id}"`, `replacement building "${to}" must be player-buildable`);
      }
    }
    assertOneSlotPerFamily(resolveRoster(nation.id), `nation "${nation.id}"`);
  }

  for (const legacy of Object.values(FACTIONS)) {
    register('legacy faction', legacy.id);
    if (!Object.hasOwn(ALLIANCES, legacy.allianceId)) {
      fail(`legacy faction "${legacy.id}"`, `unknown alliance "${legacy.allianceId}"`);
    }
    const alliance = ALLIANCES[legacy.allianceId];
    const mirrors =
      legacy.units.length === alliance.baseline.units.length &&
      legacy.units.every((id, index) => id === alliance.baseline.units[index]) &&
      legacy.buildings.length === alliance.baseline.buildings.length &&
      legacy.buildings.every((id, index) => id === alliance.baseline.buildings[index]);
    if (!mirrors) {
      fail(`legacy faction "${legacy.id}"`, 'preset must mirror its alliance baseline');
    }
    assertOneSlotPerFamily(resolveRoster(legacy.id), `legacy faction "${legacy.id}"`);
  }
}

validateRosterRegistry();
