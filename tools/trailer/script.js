/**
 * Trailer shot list.
 *
 * Each shot stages one of the shipped maps, puts real forces on it and drives a
 * camera over it. All positions — camera keys, force groups, order targets — are
 * tile offsets from the shot's anchor, so a shot reads the same whether it is
 * anchored to a map centre, a player's base or a staging area.
 *
 * Fields:
 *   id            file name for the still / clip
 *   map           export name of a map factory in src/data
 *   anchor        'map' | 'blue' | 'red' | 'units0' | 'units1' | {x, z}
 *   follow        true to track the fight instead of the anchor
 *   lead          how far the follow camera leans toward the enemy, 0..1
 *   hour          0..24 start hour (drives sun angle, ambient light, lamps)
 *   weather       'clear' | 'overcast' | ... as authored in src/sim/weather
 *   keepUnits     true to keep the map's own landing parties
 *   duration      seconds of the take
 *   previewTime   second the framing still is taken at
 *   camera        [{t, x, z, zoom, pitch?, ease?, cut?}] tile offsets, world zoom
 *   units         [{defId, owner, x, z, count?, gapX?, gapZ?, columns?}]
 *   structures    [{defId, owner, x, z}]
 *   cues          [{t, owner, type: 'attackMove'|'move', x, z, defIds?}]
 *   titles        [{from, to, kind: 'lower'|'center'|'end', text, sub, kicker?}]
 */

export const SHOTS = [
  {
    id: '01-first-light',
    map: 'createCrossingPoint',
    anchor: 'blue',
    hour: 5.8,
    weather: 'clear',
    keepUnits: true,
    duration: 7.5,
    previewTime: 4.6,
    structures: [
      { defId: 'barracks', owner: 0, x: 2, z: 8 },
      { defId: 'factory', owner: 0, x: 8, z: 8 },
      { defId: 'refinery', owner: 0, x: 13, z: 5 },
      { defId: 'powerPlant', owner: 0, x: 2, z: 13 },
      { defId: 'radar', owner: 0, x: 8, z: 13 },
      { defId: 'samBattery', owner: 0, x: 13, z: 10 },
      { defId: 'tenement', owner: 0, x: 4, z: 3 },
    ],
    units: [
      { defId: 'tank', owner: 0, x: 4, z: 18, count: 4, gapX: 2.8, gapZ: 3, columns: 2 },
      { defId: 'ifv', owner: 0, x: 9.5, z: 18, count: 2, gapX: 2.6, gapZ: 3 },
      { defId: 'rifle', owner: 0, x: 1, z: 17, count: 4, gapX: 1.6, gapZ: 1.6, columns: 2 },
    ],
    cues: [{ t: 0.3, owner: 0, type: 'move', x: 9, z: 26, defIds: ['tank', 'ifv'] }],
    camera: [
      { t: 0, x: 6, z: 11, zoom: 26, pitch: 28 },
      { t: 7.5, x: 7.5, z: 14.5, zoom: 19, pitch: 25 },
    ],
    titles: [
      {
        from: 0.8,
        to: 6.6,
        kind: 'lower',
        kicker: 'MODERN COMBINED ARMS',
        text: 'KESTREL STRAITS',
        sub: 'First light. The beachhead is still ours.',
      },
    ],
  },
  {
    id: '02-armour',
    map: 'createCrossingPoint',
    anchor: { x: 47, z: 47 },
    hour: 8.6,
    weather: 'overcast',
    follow: true,
    lead: 0,
    followRate: 3.4,
    duration: 6.5,
    previewTime: 4.5,
    units: [
      { defId: 'tank', owner: 0, x: -1.5, z: -8, count: 4, gapX: 0, gapZ: 2.6, columns: 1 },
      { defId: 'ifv', owner: 0, x: 2.2, z: -9, count: 2, gapX: 0, gapZ: 2.8, columns: 1 },
      { defId: 'recon', owner: 0, x: 4.2, z: -10.5, count: 1 },
    ],
    cues: [{ t: 0, owner: 0, type: 'move', x: 1, z: 14, defIds: ['tank', 'ifv', 'recon'] }],
    camera: [
      { t: 0, x: 1.5, z: 4.5, zoom: 16, pitch: 28 },
      { t: 6.5, x: 1.5, z: 3.5, zoom: 14, pitch: 26 },
    ],
  },
  {
    id: '03-contact',
    map: 'createCrossingPoint',
    anchor: { x: 47, z: 47 },
    hour: 17.6,
    weather: 'clear',
    duration: 8,
    previewTime: 3.4,
    units: [
      { defId: 'tank', owner: 0, x: -4, z: -2, count: 4, gapX: 2.6, gapZ: 2.8, columns: 2 },
      { defId: 'ifv', owner: 0, x: -5.5, z: 1.5, count: 2, gapX: 2.4, gapZ: 2.6 },
      { defId: 'rifle', owner: 0, x: -6.5, z: -4.5, count: 4, gapX: 1.6, gapZ: 1.6, columns: 2 },
      { defId: 'tank', owner: 1, x: 2, z: -1.5, count: 3, gapX: 2.6, gapZ: 2.8, columns: 2 },
      { defId: 'atgm', owner: 1, x: 4, z: 2, count: 2, gapX: 1.8 },
      { defId: 'rifle', owner: 1, x: 1, z: 3.5, count: 4, gapX: 1.6, gapZ: 1.6, columns: 2 },
    ],
    cues: [{ t: 0.2, owner: 0, type: 'attackMove', x: -1, z: -0.5, defIds: ['tank'] }],
    camera: [
      { t: 0, x: -1, z: 0.5, zoom: 16, pitch: 27 },
      { t: 8, x: -1, z: 0, zoom: 14, pitch: 25 },
    ],
    titles: [{ from: 0.4, to: 3, kind: 'lower', kicker: 'CONTACT', text: 'NO FLANK LEFT OPEN', sub: '' }],
  },
  {
    id: '04-urban',
    map: 'createAshcrossSprawl',
    anchor: { x: 46, z: 46 },
    hour: 16.4,
    weather: 'overcast',
    duration: 6.5,
    previewTime: 3.2,
    structures: [
      { defId: 'tenement', owner: -1, x: -9, z: -5 },
      { defId: 'officeBlock', owner: -1, x: -2, z: -8 },
      { defId: 'warehouse', owner: -1, x: 6, z: -7 },
      { defId: 'tenement', owner: -1, x: 11, z: -1 },
      { defId: 'ruin', owner: -1, x: 4, z: 5 },
      { defId: 'warehouse', owner: -1, x: -6, z: 4 },
      { defId: 'chapel', owner: -1, x: -11, z: 2 },
      { defId: 'tenement', owner: -1, x: 1, z: 8 },
    ],
    units: [
      { defId: 'rifle', owner: 0, x: -4, z: 0, count: 5, gapX: 1.4, gapZ: 1.5, columns: 3 },
      { defId: 'atgm', owner: 0, x: -2.5, z: -2, count: 2, gapX: 1.6 },
      { defId: 'medic', owner: 0, x: -5.5, z: 2, count: 1 },
      { defId: 'ifv', owner: 0, x: -1, z: 2.5, count: 2, gapX: 2.2, gapZ: 2.4 },
      { defId: 'rifle', owner: 1, x: 2, z: -0.5, count: 4, gapX: 1.4, gapZ: 1.5, columns: 2 },
      { defId: 'tank', owner: 1, x: 3, z: -3, count: 1 },
      { defId: 'atgm', owner: 1, x: 4, z: 2, count: 2, gapX: 1.6 },
    ],
    cues: [{ t: 0.4, owner: 0, type: 'attackMove', x: -1, z: 0, defIds: ['ifv'] }],
    camera: [
      { t: 0, x: 0, z: 0.5, zoom: 16, pitch: 23 },
      { t: 6.5, x: 0, z: 0, zoom: 14, pitch: 22 },
    ],
  },
  {
    id: '05-night-assault',
    map: 'createDrylands',
    anchor: 'map',
    hour: 18.8,
    weather: 'clear',
    duration: 7,
    previewTime: 4.8,
    structures: [
      { defId: 'bunker', owner: 1, x: 4, z: 0 },
      { defId: 'mgNest', owner: 1, x: 3.5, z: -3 },
      { defId: 'atTurret', owner: 1, x: 4, z: 3.5 },
      { defId: 'bunker', owner: 1, x: 7.5, z: -2 },
      { defId: 'radarStation', owner: 1, x: 8, z: 3 },
    ],
    units: [
      { defId: 'tank', owner: 0, x: -3, z: -2, count: 2, gapX: 0, gapZ: 3.4, columns: 1 },
      { defId: 'tank', owner: 0, x: -3, z: 2.4, count: 2, gapX: 0, gapZ: 3.4, columns: 1 },
      { defId: 'ifv', owner: 0, x: -5.5, z: 0, count: 2, gapX: 0, gapZ: 3 },
      { defId: 'rifle', owner: 0, x: -7, z: 1.5, count: 4, gapX: 1.6, gapZ: 1.6, columns: 2 },
      { defId: 'spg', owner: 0, x: -6, z: -4, count: 1 },
    ],
    camera: [
      { t: 0, x: 0.5, z: 0, zoom: 17, pitch: 26 },
      { t: 7, x: 1, z: 0, zoom: 14, pitch: 24 },
    ],
    titles: [{ from: 0.6, to: 3.4, kind: 'lower', kicker: 'DUG IN', text: 'BREAK THE BUNKER LINE', sub: '' }],
  },
  {
    id: '06-air',
    map: 'createCrossingPoint',
    anchor: { x: 47, z: 40 },
    hour: 6.6,
    weather: 'clear',
    duration: 6.5,
    previewTime: 3.4,
    units: [
      { defId: 'attackHelo', owner: 0, x: -4, z: -2.5, count: 3, gapX: 2.2, gapZ: 3.6 },
      { defId: 'tank', owner: 1, x: 1, z: 0.5, count: 3, gapX: 2.6, gapZ: 2.8, columns: 2 },
      { defId: 'ifv', owner: 1, x: 3, z: 3, count: 2, gapX: 2.4 },
      { defId: 'aa', owner: 1, x: 4, z: -1.5, count: 1 },
      { defId: 'rifle', owner: 1, x: 1.5, z: -3, count: 3, gapX: 1.6, gapZ: 1.6, columns: 2 },
    ],
    // No order: the flight hovers where it was placed and shoots, which keeps
    // the rotors in frame instead of racing off the edge of the map.
    camera: [
      { t: 0, x: -1, z: -0.5, zoom: 17, pitch: 30 },
      { t: 6.5, x: -0.5, z: 0, zoom: 14.5, pitch: 28 },
    ],

  },
  {
    id: '07-end-card',
    map: 'createCrossingPoint',
    anchor: { x: 47, z: 47 },
    hour: 19.6,
    weather: 'clear',
    keepUnits: true,
    duration: 5.5,
    previewTime: 4,
    camera: [
      { t: 0, x: 0, z: 3, zoom: 20, pitch: 26 },
      { t: 5.5, x: 0, z: -1, zoom: 30, pitch: 29 },
    ],
    titles: [
      {
        from: 0.4,
        to: 5.5,
        kind: 'end',
        kicker: 'COMBINED-ARMS REAL-TIME STRATEGY',
        sub: 'Author the island. Raise the army. Break the line.',
        tag: 'BETA — MODERNCOMBINEDARMS.PAGES.DEV',
      },
    ],
  },
];
