import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { parseScenario } from '../src/sim/scenario';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionLibraryError,
  copyOfImportedScenario,
  createMissionDoc,
  deleteLibraryEntry,
  duplicateLibraryEntry,
  ensureCommandPostKeys,
  ensureMissionForScenario,
  entryFromScenario,
  inspectEntry,
  libraryFilename,
  missionJson,
  objectiveReferences,
  openingVisibility,
  previewImport,
  readMissionLibrary,
  saveScenarioToLibrary,
  scenarioJsonForExport,
  searchLibrary,
  sortLibrary,
  validateMission,
  variableReferences,
  type LibraryStorage,
  type MissionDoc,
  type MissionLibraryEntry,
} from '../src/mission';

class MemoryStorage implements LibraryStorage {
  data = new Map<string, string>();
  failWrite = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function fixture(): { scenario: ReturnType<typeof createIslandAssault>; mission: MissionDoc } {
  const scenario = createIslandAssault();
  const doc = createMissionDoc(scenario, { id: 'alpha-operation', title: 'Alpha Operation' });
  scenario.mission = doc;
  return { scenario, mission: doc };
}

function issues(doc: MissionDoc, scenario = createIslandAssault()) {
  return validateMission(doc, {
    width: scenario.width,
    height: scenario.height,
    entityKeys: new Set(
      [...scenario.structures, ...scenario.units]
        .map((entry) => entry.key)
        .filter((key): key is string => Boolean(key)),
    ),
  });
}

describe('mission authoring', () => {
  it('creates a valid opening document with observable command-post triggers', () => {
    const { scenario, mission } = fixture();
    expect(mission.format).toBe(MISSION_FORMAT);
    expect(mission.version).toBe(MISSION_FORMAT_VERSION);
    expect(mission.id).toBe('alpha-operation');
    expect(mission.objectives[0].kind).toBe('primary');
    expect(mission.triggers.some((trigger) => trigger.id === 'enemy-hq-lost')).toBe(true);
    expect(issues(mission, scenario).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(scenario.structures.filter((structure) => structure.key).length).toBeGreaterThanOrEqual(2);
  });

  it('assigns unique command-post keys without rewriting existing ones', () => {
    const scenario = createIslandAssault();
    scenario.structures.find((structure) => structure.owner === 0)!.key = 'keeper';
    const result = ensureCommandPostKeys(scenario);
    expect(result.ownKey).toBe('keeper');
    expect(result.enemyKey).toBe('enemy-hq');
    const keys = scenario.structures.map((structure) => structure.key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('creates a mission only when explicitly asked and reports added keys', () => {
    const scenario = createIslandAssault();
    const result = ensureMissionForScenario(scenario, { id: 'draft' });
    expect(result.created).toBe(true);
    expect(scenario.mission?.id).toBe('draft');
    expect(result.keysAdded).toContain('own-hq');
    const second = ensureMissionForScenario(scenario);
    expect(second.created).toBe(false);
    expect(second.doc.id).toBe('draft');
  });

  it('keeps the mission id stable through a title edit', () => {
    const { mission } = fixture();
    const before = mission.id;
    mission.title = 'A different name';
    expect(mission.id).toBe(before);
    mission.id = 'renamed-explicitly';
    expect(mission.id).toBe('renamed-explicitly');
  });

  it('reports opening visibility from dependencies and initialState', () => {
    const { mission } = fixture();
    const primary = mission.objectives[0];
    expect(openingVisibility(primary)).toBe('active');
    expect(openingVisibility({ ...primary, dependsOn: ['other'] })).toBe('hidden');
    expect(openingVisibility({ ...primary, initialState: 'hidden' })).toBe('hidden');
  });

  it('finds objective and variable references across triggers and dependencies', () => {
    const { mission } = fixture();
    mission.variables.push({ id: 'count', type: 'number', default: 0 });
    mission.objectives.push({
      id: 'dependent',
      title: 'Dependent',
      kind: 'secondary',
      dependsOn: [mission.objectives[0].id],
    });
    mission.triggers.push({
      id: 'reference-probe',
      once: false,
      conditions: [{ kind: 'variable', variable: 'count', op: 'gte', value: 2 }],
      actions: [
        { kind: 'setVariable', variable: 'count', value: 3 },
        { kind: 'setObjective', objective: mission.objectives[0].id, state: 'complete' },
      ],
    });
    const refs = objectiveReferences(mission, mission.objectives[0].id);
    expect(refs.some((ref) => ref.endsWith('.dependsOn[0]'))).toBe(true);
    expect(refs.some((ref) => ref.includes('.actions['))).toBe(true);
    expect(variableReferences(mission, 'count')).toHaveLength(2);
  });

  it('rejects a draft whose primary objective was removed', () => {
    const { scenario, mission } = fixture();
    mission.objectives = mission.objectives.filter((objective) => objective.kind !== 'primary');
    const errors = issues(mission, scenario).filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.code === 'mission-primary-missing')).toBe(true);
  });
});

describe('mission library storage', () => {
  it('stores and reads a complete scenario with its mission', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    const entry = saveScenarioToLibrary(storage, scenario, {
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(entry.missionId).toBe('alpha-operation');
    expect(entry.lastValidScenarioJson).toBeTruthy();
    const read = readMissionLibrary(storage);
    expect(read.discarded).toBe(0);
    expect(read.doc.entries).toHaveLength(1);
    expect(read.doc.entries[0].title).toBe('Alpha Operation');
    const parsed = parseScenario(JSON.parse(read.doc.entries[0].scenarioJson));
    expect(parsed.mission?.id).toBe('alpha-operation');
    expect(parsed.structures.some((structure) => structure.key === 'own-hq')).toBe(true);
  });

  it('recovers from a malformed entry without discarding the rest', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    saveScenarioToLibrary(storage, scenario);
    const raw = JSON.parse(storage.getItem('iron-tide.mission-library.v1')!);
    raw.entries.push({ id: 'broken', scenarioJson: '{not json', updatedAt: '2026-01-01' });
    storage.setItem('iron-tide.mission-library.v1', JSON.stringify(raw));
    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(1);
    expect(read.discarded).toBe(1);
  });

  it('keeps the newest duplicate library identity', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    const first = entryFromScenario(scenario, { id: 'same', now: '2026-01-01T00:00:00.000Z' });
    const second = entryFromScenario(scenario, { id: 'same', now: '2026-02-01T00:00:00.000Z' });
    storage.setItem(
      'iron-tide.mission-library.v1',
      JSON.stringify({ version: 1, entries: [first, second] }),
    );
    const read = readMissionLibrary(storage);
    expect(read.doc.entries).toHaveLength(1);
    expect(read.doc.entries[0].updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(read.discarded).toBe(1);
  });

  it('refuses to save a mission with validation errors', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    saveScenarioToLibrary(storage, scenario);
    const before = storage.getItem('iron-tide.mission-library.v1');
    scenario.mission!.title = '';
    expect(() => saveScenarioToLibrary(storage, scenario)).toThrow(MissionLibraryError);
    expect(storage.getItem('iron-tide.mission-library.v1')).toBe(before);
  });

  it('rejects a second library document with the same mission id', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    saveScenarioToLibrary(storage, scenario);
    const copy = structuredClone(scenario);
    copy.meta.name = 'Other map';
    expect(() => saveScenarioToLibrary(storage, copy)).toThrow(/already stored/);
  });

  it('duplicates with a new library identity and detached mission id', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    scenario.mission!.campaign = { campaignId: 'baltic-line', order: 1 };
    const original = saveScenarioToLibrary(storage, scenario);
    const copy = duplicateLibraryEntry(storage, original.id);
    expect(copy.id).not.toBe(original.id);
    expect(copy.missionId).not.toBe(original.missionId);
    expect(copy.campaignId).toBeNull();
    expect(readMissionLibrary(storage).doc.entries).toHaveLength(2);
  });

  it('deletes only the library document', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    const entry = saveScenarioToLibrary(storage, scenario);
    expect(deleteLibraryEntry(storage, entry.id)).toBe(true);
    expect(readMissionLibrary(storage).doc.entries).toEqual([]);
    expect(scenario.mission?.id).toBe('alpha-operation');
  });

  it('surfaces storage write failures instead of pretending to save', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    storage.failWrite = true;
    expect(() => saveScenarioToLibrary(storage, scenario)).toThrow(/could not be written/);
  });

  it('searches and sorts by title, recent edit and mission id', () => {
    const storage = new MemoryStorage();
    const { scenario } = fixture();
    saveScenarioToLibrary(storage, scenario, { id: 'a', now: '2026-01-01T00:00:00.000Z' });
    scenario.mission!.id = 'zulu-operation';
    scenario.mission!.title = 'Zulu Operation';
    saveScenarioToLibrary(storage, scenario, { id: 'z', now: '2026-02-01T00:00:00.000Z' });
    const entries = readMissionLibrary(storage).doc.entries;
    expect(searchLibrary(entries, 'alpha')).toHaveLength(1);
    expect(searchLibrary(entries, 'zulu')).toHaveLength(1);
    expect(searchLibrary(entries, 'nope')).toEqual([]);
    expect(sortLibrary(entries, 'title')[0].title).toBe('Alpha Operation');
    expect(sortLibrary(entries, 'recent')[0].missionId).toBe('zulu-operation');
    expect(sortLibrary(entries, 'mission')[0].missionId).toBe('alpha-operation');
  });

  it('reports malformed stored JSON for an entry instead of throwing', () => {
    const entry: MissionLibraryEntry = {
      id: 'x',
      missionId: 'm',
      title: 'M',
      campaignId: null,
      formatVersion: 1,
      updatedAt: '2026-01-01',
      scenarioJson: '{"format":"nope"}',
      lastValidScenarioJson: null,
      lastValidAt: null,
    };
    const report = inspectEntry(entry);
    expect(report.error).toBeTruthy();
    expect(report.mission).toBeNull();
  });

  it('produces filesystem-safe filenames', () => {
    expect(libraryFilename('Baltic: Line / One', 'mission')).toBe('baltic-line-one-mission.json');
    expect(libraryFilename('', 'scenario')).toBe('mission-scenario.json');
  });
});

describe('mission import and export', () => {
  it('previews a valid standalone mission without writing it', () => {
    const { scenario, mission } = fixture();
    const preview = previewImport(JSON.parse(JSON.stringify(mission)), {
      width: scenario.width,
      height: scenario.height,
      entityKeys: new Set(['own-hq', 'enemy-hq']),
    });
    expect(preview.kind).toBe('mission');
    expect(preview.errors).toBe(0);
    expect(preview.mission.id).toBe('alpha-operation');
    expect(preview.scenario).toBeNull();
  });

  it('previews a scenario with an embedded mission', () => {
    const { scenario } = fixture();
    const preview = previewImport(JSON.parse(scenarioJsonForExport(scenario)), {
      width: scenario.width,
      height: scenario.height,
      entityKeys: new Set(),
    });
    expect(preview.kind).toBe('scenario');
    expect(preview.scenario?.mission?.id).toBe('alpha-operation');
    expect(preview.scenario?.width).toBe(scenario.width);
  });

  it('rejects unknown formats and scenarios without a mission', () => {
    expect(() =>
      previewImport({ format: 'something-else' }, { width: 10, height: 10, entityKeys: new Set() }),
    ).toThrow(MissionLibraryError);
    const noMission = createIslandAssault();
    expect(() =>
      previewImport(JSON.parse(JSON.stringify(noMission)), {
        width: noMission.width,
        height: noMission.height,
        entityKeys: new Set(),
      }),
    ).toThrow(/no mission/i);
  });

  it('rejects an unsupported mission version through the canonical parser', () => {
    const { scenario, mission } = fixture();
    const bad = { ...mission, version: 99 };
    expect(() =>
      previewImport(bad, {
        width: scenario.width,
        height: scenario.height,
        entityKeys: new Set(),
      }),
    ).toThrow(/version/i);
  });

  it('copies an imported scenario with a new mission id and no campaign link', () => {
    const { scenario } = fixture();
    scenario.mission!.campaign = { campaignId: 'baltic-line', order: 2 };
    const copy = copyOfImportedScenario(scenario, new Set(['alpha-operation']));
    expect(copy.mission?.id).not.toBe('alpha-operation');
    expect(copy.mission?.campaign).toBeUndefined();
    expect(copy.mission?.title).toContain('(Copy)');
  });

  it('round-trips exported mission and scenario JSON through their parsers', () => {
    const { scenario, mission } = fixture();
    expect(JSON.parse(missionJson(mission)).id).toBe('alpha-operation');
    const parsed = parseScenario(JSON.parse(scenarioJsonForExport(scenario)));
    expect(parsed.mission?.id).toBe(mission.id);
    expect(parsed.units.length).toBe(scenario.units.length);
    expect(parsed.objectives).toEqual(scenario.objectives);
  });

  it('never exports runtime or save state', () => {
    const { mission } = fixture();
    const json = missionJson(mission);
    for (const forbidden of ['runtime', 'campaignState', 'pending', 'deployments']) {
      expect(json.includes(`"${forbidden}"`)).toBe(false);
    }
    expect(json.includes('"elapsedSeconds"')).toBe(false);
  });
});
