/**
 * Core structural constants. Gameplay numbers live in data files; only
 * timing and structural constants belong here.
 */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TILE_SIZE = 4;
export const MAP_FORMAT = 'iron-tide-scenario';
export const MAP_FORMAT_VERSION = 1;
export const SAVE_FORMAT = 'iron-tide-save';
export const SAVE_FORMAT_VERSION = 1;

/**
 * A structure hit within this many ticks cannot be repaired: the crew can patch
 * a wall between bombardments, not during one. One second lets a single gun's
 * reload leave a workable gap while two attackers firing out of phase keep the
 * site suppressed.
 */
export const REPAIR_SUPPRESSION_TICKS = 20;

/** Height of one elevation level in world units. */
export const ELEVATION_HEIGHT = 1.15;

/** Team identifiers used by the simulation. -1 is neutral. */
export const NEUTRAL = -1;
export const PLAYER = 0;
export const ENEMY = 1;

export const MAX_TEAMS = 2;
export const MAX_QUEUE = 5;
export const MAX_SELECTION = 48;

/** Cache invalidation / refresh cadences, in ticks. */
export const  VISION_INTERVAL = 10; // 0.5s
export const INCOME_WINDOW = 20 * 60; // 60s of income history

export const STARTING_MATS = 2600;
export const STARTING_REQ = 120;

/**
 * Material units a harvester carries in one full hopper. Each authored ore
 * tile holds this much, so one full load clears one tile and pays for roughly
 * a third of a main battle tank. Presentation scales the hopper art by the
 * same number.
 */
export const HARVESTER_CAPACITY = 300;
