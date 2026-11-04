import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { parseScenario, scenarioToJson } from '../src/sim/scenario';
import {
  MISSION_LIBRARY_KEY,
  MISSION_LIBRARY_VERSION,
  MISSION_RECOVERY_KEY,
  MISSION_STORAGE_PROBE_KEY,
  MissionLibraryError,
  canRestoreLastValid,
  captureRecoveries,
  createMissionDoc,
  deleteLibraryEntry,
  describeRecovery,
  duplicateLibraryEntry,
  entryFromScenario,
  formatByteSize,
  libraryHealth,
  libraryUsageBytes,
  probeLibraryStorage,
  readLibraryRecoveries,
  readMissionLibrary,
  recoverLibraryRecord,
  scenarioFromRecoveryRaw,
  saveScenarioToLibrary,
  writeMissionLibrary,
  type LibraryStorage,
  type MissionLibraryEntry,
} from '../src/mission';
import {
  EDITOR_AUTOSAVE_KEY,
  EDITOR_DRAFT_META_KEY,
  readEditorDraft,
  writeEditorDraft,
} from '../src/mission/draft';

/**
 * Storage double with controllable failures.
 *
 * Failures are injected per key so a test can fail the metadata write while the
 * document write still succeeds, which is what a nearly full browser does.
 */
class ControlledStorage implements LibraryStorage {
  data = new Map<string, string>();
  /** Every write throws this error. */
  failWrites: Error | null = null;
  /** Only these keys reject writes. */
  failedKeys = new Set<string>();
  failReads = false;
  writes = 0;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('SecurityError: storage is blocked');
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw this.failWrites;
    if (this.failedKeys.has(key)) throw quotaError();
    this.writes++;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function quotaError(): Error {
  const error = new Error('QuotaExceededError: exceeded the quota');
  error.name = 'QuotaExceededError';
  return error;
}

function fixture(id = 'alpha-operation', title = 'Alpha Operation') {
  const scenario = createIslandAssault();
  const doc = createMissionDoc(scenario, { id, title });
  scenario.mission = doc;
  return { scenario, mission: doc };
}

function libraryText(storage: ControlledStorage): string {
  return storage.getItem(MISSION_LIBRARY_KEY) ?? '';
}

function storedEnvelope(storage: ControlledStorage): { version: number; entries: unknown[] } {
  return JSON.parse(libraryText(storage)) as { version: number; entries: unknown[] };
}

function seedCorruptEntry(storage: ControlledStorage): Record<string, unknown> {
  const raw = storedEnvelope(storage);
  const broken = {
    id: 'broken-entry',
    missionId: 'ghost-operation',
    title: 'Ghost Operation',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenarioJson: '{"format": "mca-scenario", "truncated": ',
  };
  raw.entries.push(broken);
  storage.setItem(MISSION_LIBRARY_KEY, JSON.stringify(raw));
  return broken;
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof MissionLibraryError ? error.code : 'not-a-library-error';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Corruption and recovery                                             */
/* ------------------------------------------------------------------ */

describe('library corruption and recovery', () => {
  it('loads valid entries while quarantining one unreadable entry', () => {
    const storage = new ControlledStorage();
    saveScenarioToLibrary(storage, fixture().scenario);
    saveScenarioToLibrary(storage, fixture('bravo-operation', 'Bravo Operation').scenario);
    const broken = seedCorruptEntry(storage);

    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(2);
    expect(read.discarded).toBe(1);
    expect(read.unreadable).toHaveLength(1);
    expect(read.envelope.status).toBe('ok');

    const records = readLibraryRecoveries(storage).records;
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('unparseable-entry');
    expect(records[0].entryId).toBe('broken-entry');
    expect(records[0].title).toBe('Ghost Operation');
    expect(JSON.parse(records[0].raw)).toEqual(broken);
  });

  it('keeps an unreadable entry through a later save of an unrelated document', () => {
    const storage = new ControlledStorage();
    saveScenarioToLibrary(storage, fixture().scenario);
    const broken = seedCorruptEntry(storage);

    saveScenarioToLibrary(storage, fixture('bravo-operation', 'Bravo Operation').scenario);

    const after = readMissionLibrary(storage);
    expect(after.doc.entries.map((entry) => entry.missionId).sort()).toEqual([
      'alpha-operation',
      'bravo-operation',
    ]);
    expect(after.unreadable).toEqual([broken]);
    expect(storedEnvelope(storage).entries).toContainEqual(broken);
  });

  it('preserves a malformed envelope before anything can overwrite it', () => {
    const storage = new ControlledStorage();
    const original = '{"version": 2, "entries": [';
    storage.setItem(MISSION_LIBRARY_KEY, original);

    const read = readMissionLibrary(storage);
    expect(read.envelope.status).toBe('malformed');
    expect(read.envelope.preserved).toBe(true);
    expect(read.doc.entries).toHaveLength(0);

    const record = readLibraryRecoveries(storage).records[0];
    expect(record.category).toBe('corrupt-archive');
    expect(record.raw).toBe(original);

    // A new document may now be saved; the damaged text still exists.
    saveScenarioToLibrary(storage, fixture().scenario);
    expect(readLibraryRecoveries(storage).records[0].raw).toBe(original);
    expect(readMissionLibrary(storage).doc.entries).toHaveLength(1);
  });

  it('treats an envelope without an entries list as damaged', () => {
    const storage = new ControlledStorage();
    storage.setItem(MISSION_LIBRARY_KEY, JSON.stringify({ version: 2, documents: [] }));
    const read = readMissionLibrary(storage);
    expect(read.envelope.status).toBe('malformed');
    expect(read.envelope.message).toMatch(/entries/i);
    expect(readLibraryRecoveries(storage).records[0]).toBeTruthy();
  });

  it('classifies a scenario that parses but has no mission', () => {
    const storage = new ControlledStorage();
    const scenario = fixture().scenario;
    const withoutMission = JSON.parse(scenarioToJson(scenario)) as Record<string, unknown>;
    delete withoutMission.mission;
    storage.setItem(
      MISSION_LIBRARY_KEY,
      JSON.stringify({
        version: MISSION_LIBRARY_VERSION,
        entries: [
          { id: 'no-mission', scenarioJson: JSON.stringify(withoutMission), updatedAt: '2026-01-01' },
        ],
      }),
    );
    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(0);
    expect(readLibraryRecoveries(storage).records[0].category).toBe('invalid-document');
  });

  it('classifies an entry with no library identity as bad metadata', () => {
    const storage = new ControlledStorage();
    storage.setItem(
      MISSION_LIBRARY_KEY,
      JSON.stringify({
        version: MISSION_LIBRARY_VERSION,
        entries: [{ scenarioJson: scenarioToJson(fixture().scenario) }],
      }),
    );
    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(0);
    expect(readLibraryRecoveries(storage).records[0].category).toBe('invalid-metadata');
  });

  it('returns an exportable raw payload that matches what was captured', () => {
    const storage = new ControlledStorage();
    saveScenarioToLibrary(storage, fixture().scenario);
    const broken = seedCorruptEntry(storage);
    readMissionLibrary(storage);
    const record = readLibraryRecoveries(storage).records[0];
    expect(JSON.parse(record.raw)).toEqual(broken);
    expect(describeRecovery(record).label).toMatch(/Unreadable entry/);
  });

  it('recovers a document whose metadata was broken', () => {
    const storage = new ControlledStorage();
    const scenarioJson = scenarioToJson(fixture().scenario);
    storage.setItem(
      MISSION_LIBRARY_KEY,
      JSON.stringify({ version: MISSION_LIBRARY_VERSION, entries: [{ scenarioJson }] }),
    );
    readMissionLibrary(storage);
    const record = readLibraryRecoveries(storage).records[0];
    const entry = recoverLibraryRecord(storage, record, { now: '2026-05-01T00:00:00.000Z' });
    // Recovery always lands as a detached copy, never under the original id.
    expect(entry.missionId).toBe('alpha-operation-copy');
    expect(entry.campaignId).toBeNull();
    expect(readMissionLibrary(storage).doc.entries).toHaveLength(1);
  });

  it('never replaces an existing document when recovering a duplicate mission', () => {
    const storage = new ControlledStorage();
    const original = saveScenarioToLibrary(storage, fixture().scenario);
    const captured = captureRecoveries(storage, [
      {
        category: 'unparseable-entry',
        reason: 'Synthetic recovery payload.',
        raw: JSON.stringify({
          id: 'ghost',
          missionId: original.missionId,
          title: original.title,
          scenarioJson: original.scenarioJson,
          updatedAt: original.updatedAt,
        }),
      },
    ]);
    expect(captured.created).toHaveLength(1);

    const recovered = recoverLibraryRecord(storage, captured.created[0]);
    expect(recovered.id).not.toBe(original.id);
    expect(recovered.missionId).not.toBe(original.missionId);

    const entries = readMissionLibrary(storage).doc.entries;
    expect(entries.find((entry) => entry.id === original.id)?.scenarioJson).toBe(
      original.scenarioJson,
    );
  });

  it('refuses to recover text that is not JSON', () => {
    expect(() => scenarioFromRecoveryRaw('definitely not json')).toThrow(MissionLibraryError);
    expect(codeOf(() => scenarioFromRecoveryRaw('definitely not json'))).toBe('parse');
  });

  it('refuses to guess when an archive holds several readable documents', () => {
    const storage = new ControlledStorage();
    const first = entryFromScenario(fixture().scenario);
    const second = entryFromScenario(fixture('bravo-operation', 'Bravo Operation').scenario);
    const archive = JSON.stringify({ version: MISSION_LIBRARY_VERSION, entries: [first, second] });
    const captured = captureRecoveries(storage, [
      { category: 'corrupt-archive', reason: 'Two documents.', raw: archive },
    ]);
    expect(() => recoverLibraryRecord(storage, captured.created[0])).toThrow(/one at a time/);
    expect(readMissionLibrary(storage).doc.entries).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Draft recovery                                                      */
/* ------------------------------------------------------------------ */

describe('draft recovery', () => {
  it('stores the latest draft with its metadata', () => {
    const storage = new ControlledStorage();
    const { scenario } = fixture();
    const written = writeEditorDraft(
      storage,
      scenario,
      { entryId: 'lib-1', warningCount: 2 },
      '2026-04-01T10:00:00.000Z',
    );
    expect(written.ok).toBe(true);
    expect(written.error).toBeNull();

    const draft = readEditorDraft(storage);
    expect(draft.scenario?.mission?.id).toBe('alpha-operation');
    expect(draft.meta?.savedAt).toBe('2026-04-01T10:00:00.000Z');
    expect(draft.meta?.entryId).toBe('lib-1');
    expect(draft.meta?.warningCount).toBe(2);
  });

  it('keeps an invalid draft, which is exactly when it matters', () => {
    const storage = new ControlledStorage();
    const { scenario, mission } = fixture();
    mission.objectives = mission.objectives.filter((objective) => objective.kind !== 'primary');
    const written = writeEditorDraft(storage, scenario, { errorCount: 1 });
    expect(written.ok).toBe(true);

    const draft = readEditorDraft(storage);
    expect(draft.meta?.errorCount).toBe(1);
    expect(draft.scenario?.mission?.objectives.some((o) => o.kind === 'primary')).toBe(false);
    // The library still refuses it: only the draft keeps incomplete work.
    expect(codeOf(() => saveScenarioToLibrary(storage, scenario))).toBe('invalid');
  });

  it('quarantines an unreadable draft instead of losing it', () => {
    const storage = new ControlledStorage();
    const damaged = '{"format": "mca-scenario", "width": 64,';
    storage.setItem(EDITOR_AUTOSAVE_KEY, damaged);

    const draft = readEditorDraft(storage);
    expect(draft.present).toBe(true);
    expect(draft.scenario).toBeNull();
    expect(draft.error).toBeTruthy();

    const record = readLibraryRecoveries(storage).records[0];
    expect(record.raw).toBe(damaged);
    expect(record.source).toBe(EDITOR_AUTOSAVE_KEY);
  });

  it('reports a full storage quota and keeps the previous draft', () => {
    const storage = new ControlledStorage();
    const { scenario } = fixture();
    writeEditorDraft(storage, scenario, {}, '2026-04-01T10:00:00.000Z');
    const before = storage.getItem(EDITOR_AUTOSAVE_KEY);

    storage.failWrites = quotaError();
    const failed = writeEditorDraft(storage, scenario, {}, '2026-04-02T10:00:00.000Z');
    expect(failed.ok).toBe(false);
    expect(failed.code).toBe('quota');
    expect(failed.error).toMatch(/export/i);
    expect(storage.getItem(EDITOR_AUTOSAVE_KEY)).toBe(before);
  });

  it('still stores the draft when only the metadata write fails', () => {
    const storage = new ControlledStorage();
    const { scenario } = fixture();
    storage.failedKeys.add(EDITOR_DRAFT_META_KEY);
    const written = writeEditorDraft(storage, scenario);
    expect(written.ok).toBe(true);
    expect(written.meta).toBeNull();
    expect(readEditorDraft(storage).scenario?.mission?.id).toBe('alpha-operation');
  });

  it('keeps draft and library storage independent', () => {
    const storage = new ControlledStorage();
    const { scenario } = fixture();
    writeEditorDraft(storage, scenario, {}, '2026-04-01T10:00:00.000Z');
    const draftBefore = storage.getItem(EDITOR_AUTOSAVE_KEY);

    saveScenarioToLibrary(storage, scenario);
    expect(storage.getItem(EDITOR_AUTOSAVE_KEY)).toBe(draftBefore);

    // A failed library write cannot damage the draft either.
    storage.failWrites = quotaError();
    expect(() => saveScenarioToLibrary(storage, scenario)).toThrow();
    expect(storage.getItem(EDITOR_AUTOSAVE_KEY)).toBe(draftBefore);
    expect(readEditorDraft(storage).scenario?.mission?.id).toBe('alpha-operation');
  });
});

/* ------------------------------------------------------------------ */
/* Storage failures                                                    */
/* ------------------------------------------------------------------ */

describe('library storage failures', () => {
  it('fails a create on quota without writing anything', () => {
    const storage = new ControlledStorage();
    storage.failWrites = quotaError();
    expect(codeOf(() => saveScenarioToLibrary(storage, fixture().scenario))).toBe('quota');
    expect(storage.getItem(MISSION_LIBRARY_KEY)).toBeNull();
    expect(storage.getItem(MISSION_RECOVERY_KEY)).toBeNull();
  });

  it('reports quota on replacement and preserves the stored document', () => {
    const storage = new ControlledStorage();
    const entry = saveScenarioToLibrary(storage, fixture().scenario);
    const before = libraryText(storage);
    storage.failWrites = quotaError();
    const { scenario } = fixture();
    scenario.mission!.title = 'Renamed operation';

    expect(codeOf(() => saveScenarioToLibrary(storage, scenario, { id: entry.id }))).toBe('quota');
    expect(libraryText(storage)).toBe(before);
    expect(readMissionLibrary(storage).doc.entries[0].title).toBe('Alpha Operation');
  });

  it('reports a failed delete instead of claiming success', () => {
    const storage = new ControlledStorage();
    const entry = saveScenarioToLibrary(storage, fixture().scenario);
    storage.failWrites = quotaError();
    expect(codeOf(() => deleteLibraryEntry(storage, entry.id))).toBe('quota');
    expect(storage.failWrites).not.toBeNull();
    storage.failWrites = null;
    expect(readMissionLibrary(storage).doc.entries).toHaveLength(1);
  });

  it('refuses to read or write when storage is unavailable', () => {
    const storage = new ControlledStorage();
    storage.failReads = true;

    const read = readMissionLibrary(storage);
    expect(read.envelope.status).toBe('unreadable');
    expect(read.envelope.preserved).toBe(false);
    expect(codeOf(() => saveScenarioToLibrary(storage, fixture().scenario))).toBe('unavailable');

    const health = libraryHealth(storage, { probe: true });
    expect(health.status).toBe('unavailable');
    expect(health.canWrite).toBe(false);
  });

  it('probes the store without touching another key', () => {
    const storage = new ControlledStorage();
    const ok = probeLibraryStorage(storage);
    expect(ok).toEqual({ available: true, full: false, message: null });
    expect(storage.data.has(MISSION_STORAGE_PROBE_KEY)).toBe(false);

    storage.failWrites = quotaError();
    expect(probeLibraryStorage(storage)).toMatchObject({ available: true, full: true });

    storage.failWrites = new Error('SecurityError: blocked');
    expect(probeLibraryStorage(storage).available).toBe(false);
  });

  it('keeps the open document exportable after a persistence failure', () => {
    const storage = new ControlledStorage();
    const { scenario } = fixture();
    storage.failWrites = quotaError();
    expect(() => saveScenarioToLibrary(storage, scenario)).toThrow();
    // The authoring document is untouched by the failed write.
    expect(scenario.mission?.id).toBe('alpha-operation');
    expect(JSON.parse(scenarioToJson(scenario)).mission.id).toBe('alpha-operation');
  });

  it('reports usage without claiming a fixed quota', () => {
    const storage = new ControlledStorage();
    expect(libraryUsageBytes(storage)).toBe(0);
    saveScenarioToLibrary(storage, fixture().scenario);
    expect(libraryUsageBytes(storage)).toBeGreaterThan(0);
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

/* ------------------------------------------------------------------ */
/* Integrity, migration and versions                                   */
/* ------------------------------------------------------------------ */

describe('library integrity and migration', () => {
  it('migrates an unversioned archive and is idempotent', () => {
    const storage = new ControlledStorage();
    const legacyEntry = entryFromScenario(fixture().scenario, {
      id: 'legacy',
      now: '2026-01-01T00:00:00.000Z',
    });
    const withoutStamp: Partial<MissionLibraryEntry> = { ...legacyEntry };
    delete withoutStamp.lastValidAt;
    storage.setItem(MISSION_LIBRARY_KEY, JSON.stringify([withoutStamp]));

    const first = readMissionLibrary(storage);
    expect(first.envelope.migratedFrom).toBe(0);
    expect(first.doc.version).toBe(MISSION_LIBRARY_VERSION);
    expect(first.doc.entries).toHaveLength(1);
    expect(first.doc.entries[0].missionId).toBe('alpha-operation');

    const second = readMissionLibrary(storage);
    expect(JSON.stringify(second.doc)).toBe(JSON.stringify(first.doc));

    writeMissionLibrary(storage, second.doc.entries);
    expect(storedEnvelope(storage).version).toBe(MISSION_LIBRARY_VERSION);
    expect(readMissionLibrary(storage).doc.entries[0].scenarioJson).toBe(
      first.doc.entries[0].scenarioJson,
    );
  });

  it('does not alter mission content when moving v1 to v2', () => {
    const storage = new ControlledStorage();
    const entry = entryFromScenario(fixture().scenario, { id: 'legacy' });
    storage.setItem(
      MISSION_LIBRARY_KEY,
      JSON.stringify({ version: 1, entries: [entry] }),
    );
    const read = readMissionLibrary(storage);
    expect(read.envelope.migratedFrom).toBe(1);
    const migrated = read.doc.entries[0];
    expect(parseScenario(JSON.parse(migrated.scenarioJson))).toEqual(
      parseScenario(JSON.parse(entry.scenarioJson)),
    );
  });

  it('refuses to overwrite a newer archive', () => {
    const storage = new ControlledStorage();
    const entry = entryFromScenario(fixture().scenario, { id: 'future' });
    const future = JSON.stringify({ version: 99, entries: [entry], extra: true });
    storage.setItem(MISSION_LIBRARY_KEY, future);

    const read = readMissionLibrary(storage);
    expect(read.envelope.status).toBe('future-version');
    expect(read.envelope.version).toBe(99);
    expect(read.envelope.preserved).toBe(true);
    expect(read.doc.entries).toHaveLength(1);

    expect(codeOf(() => writeMissionLibrary(storage, [], { read }))).toBe('future-version');
    expect(codeOf(() => saveScenarioToLibrary(storage, fixture('bravo-operation').scenario))).toBe(
      'future-version',
    );
    expect(libraryText(storage)).toBe(future);

    const health = libraryHealth(storage);
    expect(health.status).toBe('read-only');
    expect(health.canWrite).toBe(false);
  });

  it('keeps the newest duplicate identity and preserves the superseded copy', () => {
    const storage = new ControlledStorage();
    const older = entryFromScenario(fixture('alpha-operation', 'Older').scenario, {
      id: 'same',
      now: '2026-01-01T00:00:00.000Z',
    });
    const newer = entryFromScenario(fixture('alpha-operation', 'Newer').scenario, {
      id: 'same',
      now: '2026-02-01T00:00:00.000Z',
    });
    storage.setItem(
      MISSION_LIBRARY_KEY,
      JSON.stringify({ version: MISSION_LIBRARY_VERSION, entries: [older, newer] }),
    );

    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(1);
    expect(read.doc.entries[0].title).toBe('Newer');
    expect(read.unreadable).toHaveLength(1);
    expect(readLibraryRecoveries(storage).records[0].category).toBe('duplicate-entry');

    // Saving another document keeps the superseded record rather than pruning it.
    saveScenarioToLibrary(storage, fixture('bravo-operation').scenario);
    expect(readMissionLibrary(storage).doc.entries.map((entry) => entry.missionId).sort()).toEqual([
      'alpha-operation',
      'bravo-operation',
    ]);
    expect(readMissionLibrary(storage).unreadable).toHaveLength(1);
  });

  it('duplicates as independent documents', () => {
    const storage = new ControlledStorage();
    const original = saveScenarioToLibrary(storage, fixture().scenario);
    const copy = duplicateLibraryEntry(storage, original.id);
    const before = readMissionLibrary(storage).doc.entries.find((entry) => entry.id === copy.id)!;

    const edited = parseScenario(JSON.parse(original.scenarioJson));
    edited.mission!.title = 'Alpha Operation (edited)';
    saveScenarioToLibrary(storage, edited, { id: original.id });

    const after = readMissionLibrary(storage).doc.entries.find((entry) => entry.id === copy.id)!;
    expect(after.scenarioJson).toBe(before.scenarioJson);
    const copyDoc = parseScenario(JSON.parse(after.scenarioJson));
    expect(copyDoc.mission!.title).toBe(copy.title);
    expect(copyDoc.mission!.campaign).toBeUndefined();
  });

  it('deletes one document without touching another', () => {
    const storage = new ControlledStorage();
    const first = saveScenarioToLibrary(storage, fixture('alpha-operation').scenario);
    const second = saveScenarioToLibrary(storage, fixture('bravo-operation').scenario);
    expect(deleteLibraryEntry(storage, first.id)).toBe(true);
    const entries = readMissionLibrary(storage).doc.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(second.id);
  });

  it('keeps a validated snapshot that an invalid document may not replace', () => {
    const storage = new ControlledStorage();
    const { scenario, mission } = fixture();
    const first = saveScenarioToLibrary(storage, scenario, { now: '2026-01-01T00:00:00.000Z' });
    expect(canRestoreLastValid(first)).toBe(false);

    mission.description = 'Updated plan.';
    const second = saveScenarioToLibrary(storage, scenario, {
      id: first.id,
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(second.lastValidScenarioJson).toBe(first.scenarioJson);
    expect(canRestoreLastValid(second)).toBe(true);

    // A structurally invalid document is refused outright, so the saved copy and
    // its fallback snapshot stay exactly as they were.
    mission.title = '';
    expect(codeOf(() => saveScenarioToLibrary(storage, scenario, { id: first.id }))).toBe('invalid');
    const stored = readMissionLibrary(storage).doc.entries.find((entry) => entry.id === first.id)!;
    expect(stored.scenarioJson).toBe(second.scenarioJson);
    expect(stored.lastValidScenarioJson).toBe(second.lastValidScenarioJson);
    expect(stored.lastValidAt).toBe(second.lastValidAt);
  });

  it('describes health for a healthy and a damaged library', () => {
    const storage = new ControlledStorage();
    const healthy = libraryHealth(storage, { probe: true });
    expect(healthy.status).toBe('ok');
    expect(healthy.canWrite).toBe(true);

    saveScenarioToLibrary(storage, fixture().scenario);
    expect(libraryHealth(storage).status).toBe('ok');

    seedCorruptEntry(storage);
    const damaged = libraryHealth(storage);
    expect(damaged.status).toBe('damaged');
    expect(damaged.unreadable).toBe(1);
    expect(damaged.canWrite).toBe(true);
    expect(damaged.recoveries).toHaveLength(1);
  });

  it('exposes a stable entry shape for recovery tests', () => {
    const entry: MissionLibraryEntry = entryFromScenario(fixture().scenario);
    expect(Object.keys(entry).sort()).toEqual(
      [
        'campaignId',
        'formatVersion',
        'id',
        'lastValidAt',
        'lastValidScenarioJson',
        'missionId',
        'scenarioJson',
        'title',
        'updatedAt',
      ].sort(),
    );
  });
});
