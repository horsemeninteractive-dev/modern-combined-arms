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
}

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_FORMAT_VERSION;
  savedAt: string;
  scenario: Scenario;
  state: SerializedGameState;
  localPlayerId: number;
}
