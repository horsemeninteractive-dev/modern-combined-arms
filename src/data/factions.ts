import type { FactionDef } from '../sim/types';
import { BUILDING_LIST } from './buildings';
import { UNIT_LIST } from './units';

const allUnits = UNIT_LIST.map((u) => u.id);
const allBuildings = BUILDING_LIST.map((b) => b.id);

export const FACTIONS: Record<string, FactionDef> = {
  baltic: {
    id: 'baltic',
    name: 'Baltic Task Force',
    shortName: 'BALTIC',
    color: '#37b6e0',
    accent: '#a8ecff',
    blurb:
      'A Lithuanian-led multinational battlegroup holding the western beachhead. Balanced armour, strong infantry anti-tank teams and coalition air support.',
    units: [...allUnits],
    buildings: [...allBuildings],
  },
  expeditionary: {
    id: 'expeditionary',
    name: '11th Expeditionary Corps',
    shortName: '11th CORPS',
    color: '#ef6a4a',
    accent: '#ffc19e',
    blurb:
      'A reinforced Russian corps group dug in across the island. Heavy armour, layered air defence and a coastal missile corvette.',
    units: [...allUnits],
    buildings: [...allBuildings],
  },
};

export function factionDef(id: string): FactionDef {
  return FACTIONS[id] ?? FACTIONS.baltic;
}
