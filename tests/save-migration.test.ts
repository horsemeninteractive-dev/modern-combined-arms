import { describe, expect, it } from 'vitest';
import { Game, SaveFormatError } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { SAVE_FORMAT_VERSION } from '../src/sim/constants';
import { migrateSave } from '../src/sim/saveMigrations';

/** A current save rewound to the fields version 1 actually guaranteed. */
function legacySave(): { save: any; original: Game } {
  const original = new Game(createIslandAssault(), { enableAI: false });
  original.advance(20);
  const save = JSON.parse(JSON.stringify(original.toSave()));
  save.version = 1;
  delete save.build;
  delete save.state.charted;
  for (const e of save.state.entities) {
    delete e.aimTargetId;
    delete e.buildTargetId;
    delete e.repairTargetId;
    delete e.garrisonId;
    delete e.healTargetId;
    delete e.captureTargetId;
    delete e.captureProgress;
  }
  for (const p of save.state.players) {
    p.nationId = p.factionId;
    delete p.factionId;
    delete p.relayCount;
    // A version 1 battle predates research entirely.
    delete p.research;
  }
  return { save, original };
}

describe('save format versioning', () => {
  it('writes the current version', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    expect(game.toSave().version).toBe(SAVE_FORMAT_VERSION);
    expect(SAVE_FORMAT_VERSION).toBe(4);
  });

  it('upgrades a v1 save to the current schema', () => {
    const { save } = legacySave();
    const migrated = migrateSave(save)!;
    expect(migrated.version).toBe(SAVE_FORMAT_VERSION);
    const state = migrated.state as any;
    expect(Array.isArray(state.charted)).toBe(true);
    for (const e of state.entities) {
      expect(e.aimTargetId).toBe(0);
      expect(e.buildTargetId).toBe(0);
      expect(e.repairTargetId).toBe(0);
      expect(e.garrisonId).toBe(0);
      expect(e.healTargetId).toBe(0);
      expect(e.captureTargetId).toBe(0);
    }
    for (const p of state.players) {
      expect(typeof p.factionId).toBe('string');
      expect(p.incomeHistory).toHaveLength(60);
      // Research is initialised, never granted, when an older battle loads.
      expect(p.research).toEqual({ completed: [], project: null });
    }
  });

  it('loads a v1 battle through the same loader as a current one', () => {
    const { save, original } = legacySave();
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.state.tick).toBe(original.state.tick);
    expect(restored.state.entities.length).toBe(original.state.entities.length);
    expect(restored.player(0)!.mats).toBeCloseTo(original.player(0)!.mats, 6);
    const first = [...restored.state.entities].sort((a, b) => a.id - b.id)[0];
    const before = [...original.state.entities].sort((a, b) => a.id - b.id)[0];
    expect(first.x).toBeCloseTo(before.x, 6);
    expect(first.z).toBeCloseTo(before.z, 6);
    // The battle keeps running from the migrated state.
    restored.advance(20);
    expect(restored.state.tick).toBeGreaterThan(original.state.tick);
  });

  it('refuses a save written by a newer build instead of guessing', () => {
    const { save } = legacySave();
    save.version = SAVE_FORMAT_VERSION + 1;
    expect(() => Game.fromSave(save)).toThrow(SaveFormatError);
    expect(() => Game.fromSave(save)).toThrow(/newer build/);
  });

  it('still rejects files older than the first migration', () => {
    const { save } = legacySave();
    save.version = 0;
    expect(() => Game.fromSave(save)).toThrow(/not supported|version/i);
  });

  it('rejects unknown content after migrating rather than loading a hole', () => {
    const { save } = legacySave();
    save.state.entities = [{ defId: 'not-a-real-unit' }];
    expect(() => Game.fromSave(save)).toThrow(/not installed|corrupted/i);
  });
});
