/**
 * The Outbreak battlefield builder.
 *
 * The ground itself lives in `maps.ts`: four authored theatres, each with its
 * own approaches, cover and objectives. This module turns one of them into the
 * `Scenario` the simulation runs: it paints the map, stamps the defenders' start
 * and carries the run's difficulty, mode and seed on `meta.outbreak`.
 *
 * Everything here is deterministic for a given setup — the terrain is authored,
 * the seed is carried on the scenario, and the wave director derives the rest
 * from it — so two peers given the same setup build byte-identical ground.
 */
import { MAP_FORMAT, MAP_FORMAT_VERSION } from '../sim/constants';
import {
  clearOreUnderStructures,
  phaseSettings,
  type Scenario,
  type ScenarioPlayer,
} from '../sim/scenario';
import type { OutbreakDifficulty } from '../sim/scenario';
import { NATIONS } from '../data/factions';
import { INFECTED_FACTION_ID } from '../data/zombies';
import { outbreakDifficulty } from './config';
import {
  DEFAULT_OUTBREAK_MAP,
  DEFAULT_OUTBREAK_MAP_ID,
  OUTBREAK_MAPS,
  OUTBREAK_MAP_IDS,
  Painter,
  isOutbreakMapId,
  outbreakMap,
  type OutbreakDraft,
  type OutbreakMapDefinition,
} from './maps';
import { Terrain } from '../sim/terrain';
import type { OutbreakMode } from './types';

export {
  DEFAULT_OUTBREAK_MAP,
  DEFAULT_OUTBREAK_MAP_ID,
  OUTBREAK_MAPS,
  OUTBREAK_MAP_IDS,
  isOutbreakMapId,
  outbreakMap,
};
export type { OutbreakMapDefinition };

/** The basin: the map every pre-map run and board was recorded on. */
export const OUTBREAK_MAP_ID = DEFAULT_OUTBREAK_MAP_ID;
export const OUTBREAK_MAP_SIZE = DEFAULT_OUTBREAK_MAP.size;
export const OUTBREAK_ENTRY_REGIONS = DEFAULT_OUTBREAK_MAP.entryRegions;

export interface OutbreakSetup {
  difficulty: OutbreakDifficulty;
  mode: OutbreakMode;
  /** The defending nation. Every playable nation is eligible. */
  nationId: string;
  /** Which authored theatre to fight on. Unknown ids fall back to the basin. */
  mapId?: string;
  seed?: number;
  startWave?: number;
}

const NATION_LIST_DEFAULT = 'lithuania';

function blank(size: number): OutbreakDraft {
  const tiles = new Array(size * size);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return { tiles, structures: [], units: [] };
}

function playerFor(nationId: string, map: OutbreakMapDefinition): ScenarioPlayer {
  const nation = NATIONS[nationId] ? NATIONS[nationId] : NATIONS[NATION_LIST_DEFAULT];
  const centre = map.size / 2;
  return {
    id: 0,
    name: `${nation.name} Defence Force`,
    factionId: nation.id,
    team: 0,
    isAI: false,
    startX: centre - 2,
    startZ: centre - 2,
  };
}

function infectedPlayer(): ScenarioPlayer {
  return {
    id: 1,
    name: 'The Infected',
    factionId: INFECTED_FACTION_ID,
    team: 1,
    // The director commands them; they are never a scripted skirmish opponent.
    isAI: false,
    startX: 2,
    startZ: 2,
    color: '#8fae4a',
  };
}

/**
 * Build the Outbreak scenario for one run.
 *
 * The seed is carried on the scenario rather than baked into the ground, so the
 * same map with the same seed always produces the same waves and the same
 * opening force — which is what lets a room build both seats' battlefields from
 * one configuration.
 */
export function createOutbreakScenario(setup: OutbreakSetup): Scenario {
  const map = outbreakMap(setup.mapId);
  const draft = blank(map.size);
  map.paint(new Painter(draft, map.size));

  const config = outbreakDifficulty(setup.difficulty);
  const scenario: Scenario = {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: map.id,
      name: map.name,
      description: map.blurb,
      author: 'MCA scenario team',
      created: '2026-11-18',
      targetSize: 'large',
      outbreak: {
        difficulty: setup.difficulty,
        mode: setup.mode,
        entryRegions: map.entryRegions.map((region) => ({ ...region })),
        ...(setup.startWave !== undefined ? { startWave: setup.startWave } : {}),
      },
    },
    width: map.size,
    height: map.size,
    tiles: draft.tiles,
    players: [playerFor(setup.nationId, map), infectedPlayer()],
    structures: draft.structures,
    units: draft.units,
    objectives: [
      'Hold the Command Post at the centre of the map.',
      'Survive as many waves as possible.',
      'Keep the supply ring outside the wire working.',
      'Losing the Command Post ends the run.',
    ],
    settings: {
      ...phaseSettings(map.timeOfDay),
      seed: (setup.seed ?? 20261118) >>> 0,
      startingMats: config.startingMats,
      startingReq: config.startingReq,
      fog: true,
      // The Command Post is the only defeat condition. There is no opposing
      // headquarters to destroy and no annihilation rule to satisfy.
      victory: 'destroyHQ',
      timeLimitSec: null,
      weather: map.weather,
      timeOfDay: map.timeOfDay,
      // Strategic weapons stay available: they are part of the national
      // identity the mode promises to keep, and their long cooldowns make them
      // a between-wave decision rather than a wave-winner.
      superweapons: true,
    },
  };
  clearOreUnderStructures(scenario);
  return scenario;
}

/** Whether a loaded scenario is an Outbreak run. */
export function isOutbreakScenario(scenario: Scenario): boolean {
  return Boolean(scenario.meta.outbreak);
}
