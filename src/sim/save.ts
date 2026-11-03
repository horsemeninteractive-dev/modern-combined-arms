import { SAVE_FORMAT, SAVE_FORMAT_VERSION } from './constants';
import type { Scenario } from './scenario';
import type {
  AIControlState,
  ChartedStructure,
  ContactRecord,
  Entity,
  PlayerState,
  Projectile,
  SimEvent,
  SmokeCloud,
  VictoryState,
} from './types';

export { SAVE_FORMAT, SAVE_FORMAT_VERSION };

export interface SerializedMap {
  width: number;
  height: number;
  terrain: number[];
  elevation: number[];
  ore: number[];
  maxOre: number[];
  /** Surface/vegetation layer; absent in saves written before it existed. */
  overlay?: number[];
}

export interface SerializedGameState {
  map: SerializedMap;
  fog?: number[][];
  tick: number;
  seed: number;
  rngState: number;
  nextEntityId: number;
  nextProjectileId: number;
  eventSeq: number;
  players: PlayerState[];
  entities: Entity[];
  projectiles: Projectile[];
  events: SimEvent[];
  victory: VictoryState;
  startedAtTick: number;
  ai: AIControlState;
  contacts: ContactRecord[];
  /** Structures each team has seen, so remembered silhouettes survive a reload. */
  charted?: ChartedStructure[];
  commandCount: number;
  /**
   * Live smoke clouds. Optional: a save written before the ability layer has no
   * field, and the loader starts with a clear battlefield rather than inventing
   * one. Expired clouds are dropped on load.
   */
  smoke?: SmokeCloud[];
  nextSmokeId?: number;
}

/**
 * Which build wrote a save. Presentation provenance only: the simulation
 * neither reads it nor includes it in the state hash, and it is optional so
 * saves written before build stamping still load unchanged.
 */
export interface SaveBuildStamp {
  version: string;
  stage: string;
  build: number;
  commit: string;
}

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_FORMAT_VERSION;
  savedAt: string;
  scenario: Scenario;
  state: SerializedGameState;
  localPlayerId: number;
  /** Added by the shell when saving; older saves omit it. */
  build?: SaveBuildStamp;
}
