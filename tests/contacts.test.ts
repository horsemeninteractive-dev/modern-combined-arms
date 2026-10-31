/**
 * Contact knowledge: confirmed sightings, detected memories and last-known marks.
 *
 * These fixtures use the real vision pass — a friendly observer, an enemy it can
 * see, and then the observer withdrawn — rather than writing contact records by
 * hand, so the lifecycle is exercised exactly as a match runs it.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import {
  CONTACT_DETECTED_TICKS,
  CONTACT_EXPIRE_TICKS,
  contactAlpha,
  contactIsClassified,
  contactIsHollow,
  contactLabel,
  contactStateOf,
} from '../src/sim/contacts';
import type { ContactRecord } from '../src/sim/types';
import type { Scenario } from '../src/sim/scenario';

/** A tiny fog-enabled map: one engineer watching one enemy harvester. */
function fixture(): Scenario {
  const scenario = createEmptyScenario(48, 48);
  scenario.meta.id = 'contacts';
  scenario.settings.seed = 11;
  scenario.settings.fog = true;
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 40;
  // An unarmed observer and an unarmed target, so nothing is damaged while the
  // fixture waits for vision to refresh.
  // Both sides need a command post, or the match resolves before the vision
  // pass has run and the tick never advances.
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 8, z: 8 });
  scenario.structures.push({ defId: 'commandPost', owner: 1, x: 42, z: 42 });
  scenario.units.push({ defId: 'engineer', owner: 0, x: 20, z: 20 });
  scenario.units.push({ defId: 'harvester', owner: 1, x: 24, z: 20 });
  return scenario;
}

function start(): { game: Game; observer: ReturnType<Game['entitiesOf']>[number]; target: ReturnType<Game['entitiesOf']>[number] } {
  const game = new Game(fixture(), { enableAI: false });
  const observer = game.entitiesOf(0, 'unit').find((u) => u.defId === 'engineer')!;
  const target = game.entitiesOf(1, 'unit').find((u) => u.defId === 'harvester')!;
  return { game, observer, target };
}

function withdrawal(game: Game, observer: { x: number; z: number }): void {
  observer.x = 900;
  observer.z = 900;
  // Vision refreshes on its own cadence, so give it a second of ticks.
  game.advance(25);
}

function contactFor(game: Game, entityId: number): ContactRecord | undefined {
  return game.state.contacts.find((c) => c.team === game.teamOf(0) && c.entityId === entityId);
}

describe('contact lifecycle', () => {
  it('files a confirmed sighting with its exact definition', () => {
    const { game, target } = start();
    game.advance(2);
    const contact = contactFor(game, target.id);
    expect(contact).toBeDefined();
    expect(contactStateOf(contact!)).toBe('confirmed');
    expect(contact!.defId).toBe('harvester');
    expect(contact!.kind).toBe('unit');
    expect(contact!.band).toBe('armour');
    // A visible unit is not a remembered contact; it is drawn from its entity.
    expect(game.contactsFor(0).some((c) => c.entityId === target.id)).toBe(false);
  });

  it('degrades to detected without its exact definition when vision drops', () => {
    const { game, observer, target } = start();
    game.advance(2);
    withdrawal(game, observer);
    const contact = contactFor(game, target.id)!;
    expect(contactStateOf(contact)).toBe('detected');
    // The type is withdrawn: position and a coarse band survive, nothing else.
    expect(contact.defId).toBeUndefined();
    expect(contact.band).toBe('armour');
    expect(contactIsClassified(contact)).toBe(false);
    expect(contactIsHollow(contact)).toBe(true);
    expect(contactLabel(contact)).toBe('ARMOUR?');
    expect(game.contactsFor(0).some((c) => c.entityId === target.id)).toBe(true);
  });

  it('freezes the remembered position instead of tracking the hidden unit', () => {
    const { game, observer, target } = start();
    game.advance(2);
    const seenX = contactFor(game, target.id)!.x;
    const seenZ = contactFor(game, target.id)!.z;
    withdrawal(game, observer);
    // The target drives away while the team cannot see it.
    target.x = 200;
    target.z = 260;
    game.advance(10);
    const contact = contactFor(game, target.id)!;
    expect(contact.x).toBe(seenX);
    expect(contact.z).toBe(seenZ);
  });

  it('becomes a fading last-known mark, then expires', () => {
    const { game, observer, target } = start();
    game.advance(2);
    withdrawal(game, observer);
    game.advance(CONTACT_DETECTED_TICKS);
    const stale = contactFor(game, target.id)!;
    expect(contactStateOf(stale)).toBe('last-known');
    expect(stale.band).toBeUndefined();
    expect(stale.kind).toBeUndefined();
    expect(contactLabel(stale)).toBe('LAST KNOWN');
    expect(contactAlpha(game.state.tick, stale)).toBeLessThan(
      contactAlpha(game.state.tick, { ...stale, state: 'detected', tick: game.state.tick }),
    );
    game.advance(CONTACT_EXPIRE_TICKS);
    expect(contactFor(game, target.id)).toBeUndefined();
  });

  it('drops a contact when the unit it remembers is gone', () => {
    const { game, observer, target } = start();
    game.advance(2);
    withdrawal(game, observer);
    expect(contactFor(game, target.id)).toBeDefined();
    target.hp = 0;
    game.advance(2);
    expect(contactFor(game, target.id)).toBeUndefined();
  });

  it('keeps a building contact identified, because charted memory owns it', () => {
    const { game } = start();
    const post = game.entitiesOf(1, 'building').find((b) => b.defId === 'commandPost')!;
    // The observer cannot see it from here; simulate a confirmed sighting that
    // has since left vision, the way a scouted base leaves one behind.
    game.state.contacts.push({
      team: game.teamOf(0),
      entityId: post.id,
      x: post.x,
      z: post.z,
      tick: game.state.tick,
      defId: 'commandPost',
      kind: 'building',
      state: 'confirmed',
      band: 'structure',
    });
    game.advance(20);
    const contact = contactFor(game, post.id)!;
    expect(contactStateOf(contact)).toBe('confirmed');
    expect(contact.defId).toBe('commandPost');
  });

  it('restores contact confidence through a save round-trip', () => {
    const { game, observer, target } = start();
    game.advance(2);
    withdrawal(game, observer);
    const before = contactFor(game, target.id)!;
    expect(contactStateOf(before)).toBe('detected');
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())));
    const after = restored.state.contacts.find((c) => c.entityId === target.id)!;
    expect(contactStateOf(after)).toBe('detected');
    expect(after.defId).toBeUndefined();
    expect(after.band).toBe('armour');
    expect(after.x).toBe(before.x);
    expect(after.z).toBe(before.z);
  });
});

describe('contact presentation', () => {
  const base = { team: 0, entityId: 7, x: 100, z: 100, tick: 0 } as const;

  it('orders opacity confirmed > detected > last-known > expiring', () => {
    const confirmed = contactAlpha(0, { ...base, state: 'confirmed', defId: 'tank' });
    const detected = contactAlpha(0, { ...base, state: 'detected', band: 'armour' });
    const lastKnown = contactAlpha(CONTACT_DETECTED_TICKS + 20, { ...base, state: 'last-known' });
    const expiring = contactAlpha(CONTACT_EXPIRE_TICKS - 1, { ...base, state: 'last-known' });
    expect(confirmed).toBe(1);
    expect(detected).toBeLessThan(confirmed);
    expect(lastKnown).toBeLessThan(detected);
    expect(expiring).toBeLessThan(lastKnown);
    expect(expiring).toBeGreaterThan(0);
  });

  it('labels only what the team actually knows', () => {
    expect(contactLabel({ ...base, state: 'confirmed', defId: 'tank', band: 'armour' })).toBe('ARMOUR');
    expect(contactLabel({ ...base, state: 'detected', band: 'infantry' })).toBe('INFANTRY?');
    expect(contactLabel({ ...base, state: 'detected' })).toBe('CONTACT?');
    expect(contactLabel({ ...base, state: 'last-known' })).toBe('LAST KNOWN');
  });

  it('treats a legacy record with no state as confirmed', () => {
    const legacy = { ...base, defId: 'tank', kind: 'unit' } as const;
    expect(contactStateOf(legacy)).toBe('confirmed');
    expect(contactIsClassified(legacy)).toBe(true);
    expect(contactIsHollow(legacy)).toBe(false);
  });
});
