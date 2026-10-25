import type { BuildingDef } from './types';

/**
 * Short, player-facing description of what a completed strategic structure
 * actually contributes. Income and reconnaissance live on the definition so
 * the simulation, capture messages and HUD all describe the same numbers.
 */
export function structureBenefit(def: BuildingDef): string {
  const parts: string[] = [];
  if ((def.reqPerSec ?? 0) > 0) parts.push(`+${trim(def.reqPerSec!)} requisition/s`);
  if ((def.matsPerSec ?? 0) > 0) parts.push(`+${trim(def.matsPerSec!)} materials/s`);
  if ((def.scanRadius ?? 0) > 0) parts.push(`${def.scanRadius}-tile scan`);
  return parts.join(' · ');
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
