/**
 * Sensor and night-fighting capability data.
 *
 * One reusable description per unit or structure, so combat code never tests a
 * defId. Capabilities follow the roster that already exists: infantry are
 * optical, reconnaissance and most tanks carry thermal optics, aircraft and
 * warships rely on avionics or radar, logistics vehicles drive on headlights.
 * Values are deliberately conservative and tunable; nothing here invents a
 * weapon or a sensor that the unit does not already represent.
 */

import { unitFamily } from './units';

export type SensorKind = 'optical' | 'nightVision' | 'thermal' | 'radar' | 'avionics';

export type IlluminatorKind = 'none' | 'headlights' | 'searchlight' | 'floodlight' | 'windows' | 'beacon';

export interface SensorProfile {
  /** 0..1: how much of its daytime detection survives full darkness. */
  nightVision: number;
  /** 0..1: how well it identifies and engages a target in the dark. */
  acquire: number;
  kind: SensorKind;
  illuminator: IlluminatorKind;
  /** Human-readable capability for the unit inspector. */
  label: string;
}

const OPTICAL: SensorProfile = {
  nightVision: 0.45,
  acquire: 0.5,
  kind: 'optical',
  illuminator: 'none',
  label: 'Optical sights',
};

const NIGHT_OPTICS: SensorProfile = {
  nightVision: 0.6,
  acquire: 0.62,
  kind: 'nightVision',
  illuminator: 'none',
  label: 'Night-vision optics',
};

const THERMAL: SensorProfile = {
  nightVision: 0.82,
  acquire: 0.86,
  kind: 'thermal',
  illuminator: 'none',
  label: 'Thermal imaging',
};

const RECON_THERMAL: SensorProfile = {
  nightVision: 0.92,
  acquire: 0.9,
  kind: 'thermal',
  illuminator: 'searchlight',
  label: 'Thermal sight + searchlight',
};

const AVIONICS: SensorProfile = {
  nightVision: 0.7,
  acquire: 0.75,
  kind: 'avionics',
  illuminator: 'none',
  label: 'Aircraft avionics',
};

const RECON_AVIONICS: SensorProfile = {
  nightVision: 0.95,
  acquire: 0.9,
  kind: 'avionics',
  illuminator: 'none',
  label: 'Reconnaissance sensor suite',
};

const NAVAL_RADAR: SensorProfile = {
  nightVision: 0.78,
  acquire: 0.8,
  kind: 'radar',
  illuminator: 'beacon',
  label: 'Surface radar',
};

const SUB_RADAR: SensorProfile = {
  nightVision: 0.7,
  acquire: 0.72,
  kind: 'radar',
  illuminator: 'none',
  label: 'Periscope radar',
};

const LOGISTICS: SensorProfile = {
  nightVision: 0.4,
  acquire: 0.45,
  kind: 'optical',
  illuminator: 'headlights',
  label: 'Optical sights, convoy lights',
};

/**
 * Armour and artillery carry headlights like any other vehicle. Driving with
 * them on is a real trade in the dark: the crew sees its own ground, and every
 * enemy nearby sees the lamps.
 */
const VEHICLE: SensorProfile = {
  nightVision: 0.82,
  acquire: 0.86,
  kind: 'thermal',
  illuminator: 'headlights',
  label: 'Thermal imaging, headlights',
};

/**
 * An engineering vehicle works after dark and cannot work blind. It carries
 * work lamps and a night sight, so it is the one support vehicle whose reach
 * holds up at night: an engineer that cannot find the objective it was sent to
 * capture is not a support unit, it is a liability.
 */
const ENGINEERING: SensorProfile = {
  nightVision: 0.62,
  acquire: 0.68,
  kind: 'nightVision',
  illuminator: 'headlights',
  label: 'Work lights and night optics',
};

/** Units with an authored difference from the baseline for their role. */
export const UNIT_SENSORS: Record<string, SensorProfile> = {
  engineer: ENGINEERING,
  harvester: LOGISTICS,
  recovery: LOGISTICS,
  rifle: OPTICAL,
  medic: OPTICAL,
  atgm: NIGHT_OPTICS,
  tank: VEHICLE,
  spearhead: { ...VEHICLE, nightVision: 0.86, acquire: 0.9, label: 'Thermal imaging (upgraded), headlights' },
  spg: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Night-vision optics, headlights' },
  mlrs: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Night-vision optics, headlights' },
  heavyHowitzer: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Night-vision optics, headlights' },
  recon: RECON_THERMAL,
  pathfinder: { ...NIGHT_OPTICS, nightVision: 0.68, illuminator: 'none', label: 'Pathfinder night optics' },
  aa: { ...THERMAL, kind: 'radar', illuminator: 'headlights', label: 'Radar + thermal tracker, headlights' },
  fighter: AVIONICS,
  interceptor: AVIONICS,
  uav: RECON_AVIONICS,
  deepReconUAV: RECON_AVIONICS,
  // National exclusives author their own optics: an exclusive has no canonical
  // slot to inherit from, so without an entry it would fall back to a
  // rifleman's eye whatever it actually is.
  kestrelTeam: { ...NIGHT_OPTICS, label: 'MANPADS sight, night optics' },
  hedgehogTeam: { ...NIGHT_OPTICS, label: 'Night-vision missile sight' },
  taszar: OPTICAL,
  wilk: { ...VEHICLE, label: 'Thermal imaging, headlights' },
  stormShadow: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Mission planning optics, headlights' },
  tosp: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Thermobaric sight, headlights' },
  sprut: { ...NIGHT_OPTICS, illuminator: 'headlights', label: 'Open scout optics, headlights' },
  missileBoat: NAVAL_RADAR,
  frigate: NAVAL_RADAR,
  corvette: NAVAL_RADAR,
  submarine: SUB_RADAR,
};

const STRUCTURE_OPTICAL: SensorProfile = {
  nightVision: 0.55,
  acquire: 0.6,
  kind: 'optical',
  illuminator: 'none',
  label: 'Optical observation',
};

const STRUCTURE_FLOODLIT: SensorProfile = {
  nightVision: 0.8,
  acquire: 0.78,
  kind: 'optical',
  illuminator: 'floodlight',
  label: 'Floodlit perimeter',
};

const STRUCTURE_RADAR: SensorProfile = {
  nightVision: 0.85,
  acquire: 0.85,
  kind: 'radar',
  illuminator: 'beacon',
  label: 'Radar installation',
};

/** Structures, grouped by what they actually are. */
export const BUILDING_SENSORS: Record<string, SensorProfile> = {
  commandPost: { ...STRUCTURE_FLOODLIT, nightVision: 0.88, label: 'Command post floodlights' },
  barracks: { ...STRUCTURE_FLOODLIT, illuminator: 'windows', label: 'Lit barracks' },
  factory: { ...STRUCTURE_FLOODLIT, label: 'Industrial floodlights' },
  refinery: { ...STRUCTURE_FLOODLIT, label: 'Refinery floodlights' },
  airfield: { ...STRUCTURE_FLOODLIT, nightVision: 0.9, label: 'Airfield lighting' },
  heliport: { ...STRUCTURE_FLOODLIT, nightVision: 0.9, label: 'Heliport lighting' },
  shipyard: { ...STRUCTURE_FLOODLIT, label: 'Dock lighting' },
  powerPlant: { ...STRUCTURE_FLOODLIT, illuminator: 'windows', label: 'Plant lighting' },
  radar: { ...STRUCTURE_RADAR, label: 'Radar station' },
  radarStation: { ...STRUCTURE_RADAR, label: 'Radar station' },
  samBattery: { ...STRUCTURE_OPTICAL, nightVision: 0.72, kind: 'radar', label: 'Fire-control radar' },
  mgNest: STRUCTURE_OPTICAL,
  atTurret: STRUCTURE_OPTICAL,
  coastalBattery: { ...STRUCTURE_OPTICAL, nightVision: 0.7, label: 'Coastal fire control' },
  relay: { ...STRUCTURE_OPTICAL, illuminator: 'beacon', label: 'Signals relay' },
  supplyDepot: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit depot' },
  tenement: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit windows' },
  warehouse: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit windows' },
  officeBlock: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit offices' },
  civicHall: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit hall' },
  foundryWorks: { ...STRUCTURE_FLOODLIT, label: 'Foundry lighting' },
  chapel: { ...STRUCTURE_OPTICAL, nightVision: 0.65, illuminator: 'windows', label: 'Lit chapel' },
  farmhouse: { ...STRUCTURE_OPTICAL, illuminator: 'windows', label: 'Lit farmhouse' },
  constabulary: { ...STRUCTURE_OPTICAL, nightVision: 0.7, illuminator: 'windows', label: 'Lit police station' },
  // A lookout has a lamp, not lit windows: a single bright point in the dark
  // that is exactly as easy to find as it is useful to its owner.
  watchtower: { ...STRUCTURE_OPTICAL, nightVision: 0.6, illuminator: 'beacon', label: 'Lookout lamp' },
  ruin: { ...STRUCTURE_OPTICAL, illuminator: 'none', label: 'No lighting' },
  bunker: { ...STRUCTURE_OPTICAL, nightVision: 0.7, label: 'Emplacement optics' },
  forwardPost: { ...STRUCTURE_RADAR, nightVision: 0.8, label: 'Forward observation optics' },
  researchCentre: { ...STRUCTURE_FLOODLIT, nightVision: 0.9, label: 'Laboratory lighting' },
  signalsBureau: { ...STRUCTURE_FLOODLIT, nightVision: 0.88, label: 'Bureau lighting' },
  armourWorks: { ...STRUCTURE_FLOODLIT, label: 'Workshop floodlights' },
  expeditionaryAirfield: { ...STRUCTURE_FLOODLIT, nightVision: 0.86, label: 'Expeditionary strip lighting' },
  longRangeSam: { ...STRUCTURE_OPTICAL, nightVision: 0.74, kind: 'radar', label: 'Long-range fire-control radar' },
};

/**
 * A unit with no authored profile inherits its canonical slot's optics, so an
 * alliance platform sees the night the way its role does instead of falling
 * back to an infantryman's eye. */
export function unitSensorProfile(defId: string): SensorProfile {
  if (UNIT_SENSORS[defId]) return UNIT_SENSORS[defId];
  const slot = unitFamily(defId);
  return (slot !== defId ? UNIT_SENSORS[slot] : undefined) ?? OPTICAL;
}

export function buildingSensorProfile(defId: string): SensorProfile {
  return BUILDING_SENSORS[defId] ?? STRUCTURE_OPTICAL;
}
