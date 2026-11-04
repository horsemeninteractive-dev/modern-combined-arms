/**
 * Eastern Corridor theatres.
 *
 * The corridor's operations cross much of the same front as the Baltic Line,
 * but never on the same ground: each theatre here is authored for the eastern
 * commander's operation, with its own deployment, terrain and landmarks. The
 * paired battles of the two campaigns are neighbours in the same country, not
 * mirror images of one map.
 */
import { Terrain } from '../../sim/terrain';
import type { Scenario } from '../../sim/scenario';
import { Theatre, type TheatrePlayerSpec } from './theatre';
import type { TheatreRegion } from './mapsBaltic';

const CORPS_LIGHT = ['rifle', 'rifle', 'rifle', 'atgm', 'medic', 'recon', 'engineer', 'harvester'];
const CORPS_ARMOUR = [
  'rifle',
  'rifle',
  'atgm',
  'medic',
  'recon',
  'engineer',
  'harvester',
  'harvester',
  'tank',
  'tank',
];
const NATO_LIGHT = ['rifle', 'rifle', 'rifle', 'atgm', 'medic', 'recon', 'engineer', 'harvester'];
const NATO_ARMOUR = [
  'rifle',
  'rifle',
  'atgm',
  'medic',
  'recon',
  'engineer',
  'harvester',
  'harvester',
  'tank',
  'ifv',
];

/* ------------------------------------------------------------------ */
/* CORRIDOR / 01 — Red Beach                                           */
/* ------------------------------------------------------------------ */

export const RED_BEACH_REGIONS = {
  plateau: { id: 'plateau', name: 'Landing plateau', x: 60, z: 14, width: 18, height: 12 },
  pass: { id: 'ridge-pass', name: 'Ridge pass', x: 48, z: 31, width: 9, height: 8 },
  beachhead: { id: 'beachhead', name: 'Coalition beachhead', x: 14, z: 30, width: 16, height: 14 },
} as const satisfies Record<string, TheatreRegion>;

/** The corps landing: sea to the east, the plateau, the pass and the beachhead. */
export function createRedBeach(): Scenario {
  const t = new Theatre(96, 72, 0x1a2b);
  t.sea(
    (x, z) =>
      x > 84 ||
      z > 58 ||
      z < 4 ||
      (x > 70 && z < 12) ||
      (x < 10 && z > 46),
  );
  t.rect(60, 10, 26, 34, Terrain.Grass, 2);
  t.rect(58, 40, 26, 16, Terrain.Industrial, 1);
  t.scatter(Terrain.Forest, 12, { radius: 3, within: (x) => x < 56 });
  t.scatter(Terrain.Scrub, 8, { radius: 2 });

  t.ridge([[50, 6], [50, 30]], 3);
  t.ridge([[50, 43], [50, 56]], 3);
  t.ridge([[50, 30], [42, 16]], 2);

  t.rect(36, 24, 10, 9, Terrain.Urban, 1);
  t.structure('relay', -1, 41, 27, { key: 'village-relay' });
  t.structure('tenement', -1, 37, 25);
  t.structure('warehouse', -1, 43, 30);

  t.road([[80, 26], [62, 30], [52, 35], [42, 31], [30, 36], [18, 40]], 3);
  t.road([[42, 31], [42, 42]], 2);

  t.base(0, 78, 26);
  t.base(1, 22, 42);
  t.structure('supplyDepot', -1, 34, 38, { key: 'village-depot' });
  t.structure('radarStation', 1, 16, 34, { key: 'coalition-radar' });

  t.force(0, [...CORPS_LIGHT, 'tank'], 74, 34);
  t.force(1, NATO_LIGHT, 26, 48);

  t.ore(84, 40, 3, 820);
  t.ore(14, 52, 3, 820);
  t.ore(52, 48, 3, 700);

  // The first wave: naval infantry, one tank and engineers. The corridor's own
  // armour, guns, aviation and fleet arrive operation by operation.
  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps Landing Group',
      factionId: 'russia',
      start: [78, 26],
      restrictions: {
        technologies: [
          'manoeuvre1',
          'manoeuvre2',
          'fires1',
          'fires2',
          'air1',
          'air2',
          'naval1',
          'naval2',
          'hypersonicGlide',
          'terminalSeeker',
          'salvoControl',
          'penetrationAids',
          'spectrumDenial',
          'emitterMapping',
          'swarmControl',
          'autonomousStrike',
          'directedEnergyPower',
          'beamTargeting',
        ],
        buildings: ['researchCentre', 'airfield', 'shipyard'],
        // One tank came ashore with the first wave; nothing else in the
        // armoured, artillery, aviation or naval branches did.
        units: [
          'ifv',
          'td',
          'spg',
          'rocketArtillery',
          'uav',
          'interceptor',
          'fighter',
          'attackHelo',
          'missileBoat',
          'corvette',
          'frigate',
          'submarine',
          'navalSupport',
        ],
      },
    },
    { name: 'Lithuanian Beachhead Group', factionId: 'lithuania', start: [22, 42], isAI: true },
  ];
  return t.build(
    {
      id: 'red-beach',
      name: 'Red Beach — The Landing',
      description:
        'The corps landing on the eastern plateau, the ridge pass beyond it and the coalition beachhead on the far shore.',
      targetSize: 'large',
    },
    players,
    {
      settings: {
        seed: 0x1a2b,
        startingMats: 2200,
        startingReq: 90,
        fog: true,
        // The landing is a first-wave operation: no strategic capability is
        // authorised until the corridor has secured its command chain.
        superweapons: false,
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 02 — Foundry Pocket                                      */
/* ------------------------------------------------------------------ */

export const FOUNDRY_POCKET_REGIONS = {
  foundry: { id: 'foundry', name: 'Foundry core', x: 34, z: 22, width: 14, height: 14 },
  tenements: { id: 'tenements', name: 'Tenements', x: 50, z: 34, width: 14, height: 12 },
  rail: { id: 'rail', name: 'Rail link', x: 22, z: 36, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** The city from the eastern side: tenements first, foundry core last. */
export function createFoundryPocket(): Scenario {
  const t = new Theatre(88, 64, 0x2b3c);
  t.scatter(Terrain.Farmland, 8, { radius: 3, within: (x) => x < 22 || x > 66 });
  t.rect(24, 12, 48, 40, Terrain.DenseUrban, 1);
  for (let x = 26; x < 70; x += 9) t.rect(x, 12, 2, 40, Terrain.Road, 1);
  for (let z = 14; z < 50; z += 9) t.rect(24, z, 48, 2, Terrain.Road, 1);
  t.rect(34, 22, 14, 14, Terrain.Industrial, 1);
  t.rect(50, 34, 14, 12, Terrain.Urban, 1);
  t.blob(16, 14, 6, Terrain.Forest, 1);

  t.structure('foundryWorks', -1, 41, 29, { key: 'foundry-core' });
  t.structure('officeBlock', -1, 56, 38);
  t.structure('tenement', -1, 28, 20);
  t.structure('civicHall', -1, 34, 42);
  t.structure('warehouse', 1, 24, 40, { key: 'rail-depot' });

  t.base(0, 76, 32);
  t.base(1, 12, 32);

  t.force(0, CORPS_ARMOUR, 76, 24);
  t.force(1, [...NATO_ARMOUR, 'atgm'], 12, 24);
  t.force(1, ['rifle', 'rifle'], 44, 30);

  t.ore(80, 46, 3, 780);
  t.ore(8, 46, 3, 780);
  t.ore(44, 54, 3, 640);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Belarusian City Group',
      factionId: 'belarus',
      start: [76, 32],
      technologies: ['manoeuvre1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires1', 'fires2', 'air1', 'air2', 'naval1', 'naval2'],
        buildings: ['airfield', 'shipyard'],
        units: ['td', 'spg', 'rocketArtillery', 'uav', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Polish City Garrison', factionId: 'poland', start: [12, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'foundry-pocket',
      name: 'Foundry District — The Pocket',
      description:
        'Tenement blocks and a fortified foundry core. The rail link is the only way to feed the assault.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x2b3c, startingMats: 2600, startingReq: 110, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 03 — Strait Blockade                                     */
/* ------------------------------------------------------------------ */

export const STRAIT_BLOCKADE_REGIONS = {
  channel: { id: 'channel', name: 'Blockade line', x: 38, z: 26, width: 18, height: 14 },
  isle: { id: 'radar-isle', name: 'Radar isle', x: 24, z: 12, width: 12, height: 10 },
  yard: { id: 'yard', name: 'Coalition yard', x: 20, z: 40, width: 14, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** The blockade: the corps has to close a channel the coalition still uses. */
export function createStraitBlockade(): Scenario {
  const t = new Theatre(96, 64, 0x3c4d);
  t.sea(
    (x, z) =>
      !(x > 66 || x < 30 || (x >= 40 && x <= 52 && z > 16 && z < 46)) || (z > 52 && x > 44),
  );
  t.disc(46, 30, 8, Terrain.Grass, 1);
  t.disc(28, 16, 6, Terrain.Rock, 2);
  t.blob(78, 20, 5, Terrain.Forest, 1);
  t.blob(18, 24, 5, Terrain.Forest, 1);
  t.road([[70, 34], [80, 34], [86, 30]], 2);

  t.base(0, 80, 32);
  t.base(1, 16, 36);
  t.structure('shipyard', 0, 69, 40, { key: 'corps-yard', facing: Math.PI });
  t.structure('shipyard', 1, 27, 44, { key: 'coalition-yard', facing: 0 });
  t.structure('coastalBattery', 0, 68, 44, { key: 'corps-battery', facing: Math.PI });
  t.structure('coastalBattery', 1, 29, 44, { key: 'coalition-battery', facing: 0 });
  t.structure('radarStation', 1, 28, 16, { key: 'isle-radar' });

  t.force(0, CORPS_LIGHT, 80, 24);
  t.navalForce(0, ['corvette', 'missileBoat'], 74, 34);
  t.force(1, NATO_LIGHT, 16, 28);
  t.navalForce(1, ['corvette'], 24, 40);
  t.navalForce(1, ['missileBoat'], 24, 48);

  t.ore(86, 44, 3, 800);
  t.ore(10, 44, 3, 800);
  t.ore(46, 36, 2, 420);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps Blockade Group',
      factionId: 'russia',
      start: [80, 32],
      technologies: ['naval1', 'manoeuvre1'],
      restrictions: {
        technologies: ['naval2', 'manoeuvre2', 'fires1', 'fires2', 'air1', 'air2'],
        buildings: ['airfield'],
        units: ['td', 'spg', 'rocketArtillery', 'uav', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Coalition Channel Group', factionId: 'uk', start: [16, 36], isAI: true },
  ];
  return t.build(
    {
      id: 'strait-blockade',
      name: 'Kestrel Straits — Blockade',
      description:
        'A narrow blockade line, a radar isle and the coalition yard that keeps the channel open.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x3c4d, startingMats: 2400, startingReq: 120, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 04 — Iron Column                                         */
/* ------------------------------------------------------------------ */

export const IRON_COLUMN_REGIONS = {
  breach: { id: 'breach', name: 'The breach', x: 40, z: 28, width: 12, height: 10 },
  northPass: { id: 'north-pass', name: 'North pass', x: 38, z: 12, width: 12, height: 10 },
  gunline: { id: 'gunline', name: 'Coalition gun line', x: 22, z: 40, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** A dusk armoured breach through a prepared coalition line. */
export function createIronColumn(): Scenario {
  const t = new Theatre(88, 64, 0x4d5e);
  t.scatter(Terrain.Farmland, 12, { radius: 3 });
  t.scatter(Terrain.Scrub, 10, { radius: 2 });
  t.ridge([[44, 2], [44, 20]], 3);
  t.ridge([[44, 32], [44, 62]], 3);
  t.blob(30, 30, 5, Terrain.Rocks, 2);
  t.blob(58, 44, 5, Terrain.Rocks, 2);
  // Prepared line: trenches as mud and hardpoints on the western side.
  t.rect(28, 24, 2, 16, Terrain.Mud, 1);
  t.rect(32, 24, 2, 16, Terrain.Mud, 1);

  t.road([[74, 32], [56, 30], [46, 27], [34, 30], [16, 32]], 3);
  t.road([[44, 16], [56, 12], [70, 12]], 2);

  t.base(0, 74, 32);
  t.base(1, 14, 32);
  t.structure('supplyDepot', 1, 22, 24, { key: 'coalition-depot' });
  t.structure('bunker', 1, 32, 40, { key: 'coalition-bunker' });
  t.structure('forwardPost', 1, 34, 26);

  t.force(0, [...CORPS_ARMOUR, 'td'], 74, 24);
  t.force(1, [...NATO_ARMOUR, 'atgm', 'atgm'], 14, 24);
  t.force(1, ['atgm'], 30, 38);

  t.ore(80, 46, 3, 780);
  t.ore(8, 46, 3, 780);
  t.ore(46, 50, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Belarusian Armoured Column',
      factionId: 'belarus',
      start: [74, 32],
      technologies: ['manoeuvre1', 'manoeuvre2'],
      restrictions: {
        technologies: ['fires1', 'fires2', 'air1', 'air2', 'naval1', 'naval2'],
        buildings: ['airfield', 'shipyard'],
        units: ['spg', 'rocketArtillery', 'uav', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Polish Defence Line', factionId: 'poland', start: [14, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'iron-column',
      name: 'Iron Column — The Breach',
      description:
        'A prepared coalition line, two trench belts and a single armoured breach at dusk.',
      targetSize: 'large',
    },
    players,
    {
      settings: {
        seed: 0x4d5e,
        startingMats: 2800,
        startingReq: 130,
        fog: true,
        timeOfDay: 'dusk',
        startHour: 18,
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 05 — Drone Line                                          */
/* ------------------------------------------------------------------ */

export const DRONE_LINE_REGIONS = {
  launch: { id: 'launch', name: 'Launch belt', x: 30, z: 22, width: 14, height: 12 },
  net: { id: 'net', name: 'Air defence net', x: 42, z: 34, width: 16, height: 12 },
  radar: { id: 'radar', name: 'Coalition radar', x: 22, z: 36, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** A drone war over open farmland: reach, radar and air defence. */
export function createDroneLine(): Scenario {
  const t = new Theatre(84, 64, 0x5e6f);
  t.scatter(Terrain.Farmland, 20, { radius: 4 });
  t.scatter(Terrain.Scrub, 10, { radius: 2 });
  t.blob(50, 20, 6, Terrain.Forest, 1);
  t.blob(30, 46, 6, Terrain.Forest, 1);
  t.road([[12, 32], [30, 30], [52, 32], [72, 32]], 3);
  t.road([[52, 32], [52, 12]], 2);

  t.base(0, 74, 32, { air: true });
  t.base(1, 12, 32, { air: true });
  t.structure('radarStation', 1, 26, 38, { key: 'coalition-radar' });
  t.structure('samBattery', 1, 34, 26);
  t.structure('samBattery', 1, 24, 28);
  t.structure('relay', -1, 46, 34, { key: 'net-relay' });

  t.force(0, [...CORPS_ARMOUR, 'uav', 'uav', 'interceptor'], 74, 24);
  t.force(1, [...NATO_ARMOUR, 'uav', 'interceptor'], 12, 24);

  t.ore(78, 48, 3, 780);
  t.ore(8, 48, 3, 780);
  t.ore(52, 44, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Iranian Expeditionary Group',
      factionId: 'iran',
      start: [74, 32],
      technologies: ['manoeuvre1', 'air1', 'fires1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires2', 'air2', 'naval1', 'naval2'],
        buildings: ['shipyard'],
        units: ['td', 'rocketArtillery', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Coalition Air Defence Group', factionId: 'uk', start: [12, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'drone-line',
      name: 'The Dry Belt — Drone Line',
      description:
        'Open farmland, one radar station and a stacked air-defence net. The corridor fights this one at reach.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x5e6f, startingMats: 2800, startingReq: 140, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 06 — Kestrel Reach                                       */
/* ------------------------------------------------------------------ */

export const KESTREL_REACH_REGIONS = {
  bridge: { id: 'bridge', name: 'River bridge', x: 40, z: 28, width: 10, height: 10 },
  farBank: { id: 'far-bank', name: 'Far bank', x: 22, z: 30, width: 14, height: 12 },
  mill: { id: 'mill', name: 'Mill crossing', x: 46, z: 14, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** A river crossing: two bridges, one far bank, and a mill worth holding. */
export function createKestrelReach(): Scenario {
  const t = new Theatre(88, 68, 0x6f70);
  t.scatter(Terrain.Farmland, 14, { radius: 4 });
  t.scatter(Terrain.Forest, 10, { radius: 3 });
  // The river runs north to south, with one road bridge and one mill crossing.
  t.line(44, 0, 44, 26, Terrain.ShallowWater, 3, 0);
  t.line(44, 36, 44, 68, Terrain.ShallowWater, 3, 0);
  t.line(44, 10, 50, 14, Terrain.ShallowWater, 2, 0);
  t.rect(42, 26, 5, 10, Terrain.Road, 1);
  t.rect(46, 13, 5, 3, Terrain.Road, 1);
  t.rect(30, 30, 8, 8, Terrain.Urban, 1);

  t.road([[78, 34], [58, 32], [46, 31], [30, 31], [12, 32]], 3);
  t.road([[48, 14], [62, 12], [76, 12]], 2);

  t.base(0, 76, 34);
  t.base(1, 14, 32);
  t.structure('farmhouse', -1, 28, 24, { key: 'mill' });
  t.structure('chapel', -1, 34, 34);
  t.structure('supplyDepot', 1, 20, 40, { key: 'coalition-depot' });

  t.force(0, [...CORPS_ARMOUR, 'spg'], 76, 26);
  t.force(1, [...NATO_ARMOUR, 'atgm'], 14, 24);
  t.force(1, ['rifle', 'atgm'], 30, 28);

  t.ore(82, 48, 3, 780);
  t.ore(6, 48, 3, 780);
  t.ore(30, 52, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Belarusian River Group',
      factionId: 'belarus',
      start: [76, 34],
      technologies: ['manoeuvre1', 'fires1', 'fires2'],
      restrictions: {
        technologies: ['manoeuvre2', 'air1', 'air2', 'naval1', 'naval2'],
        buildings: ['airfield', 'shipyard'],
        units: ['td', 'uav', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Lithuanian River Group', factionId: 'lithuania', start: [14, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'kestrel-reach',
      name: 'Kestrel Reach — The Crossing',
      description:
        'One river, two crossings and a far bank. Artillery can shell the bridges, but only infantry can hold them.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x6f70, startingMats: 2800, startingReq: 130, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 07 — Coast Road                                          */
/* ------------------------------------------------------------------ */

export const COAST_ROAD_REGIONS = {
  road: { id: 'coast-road', name: 'Coast road', x: 36, z: 34, width: 18, height: 10 },
  headland: { id: 'headland', name: 'Headland', x: 50, z: 16, width: 14, height: 12 },
  harbour: { id: 'harbour', name: 'Harbour', x: 18, z: 42, width: 13, height: 11 },
} as const satisfies Record<string, TheatreRegion>;

/** A coastal road under naval gunfire: the corridor's push to the water. */
export function createCoastRoad(): Scenario {
  const t = new Theatre(92, 64, 0x7081);
  t.sea((x, z) => z > 54 || x > 86 || (x > 66 && z > 46));
  t.rect(12, 42, 22, 12, Terrain.Sand, 1);
  t.blob(52, 24, 8, Terrain.Rock, 2);
  t.blob(30, 24, 7, Terrain.Forest, 1);
  t.scatter(Terrain.Scrub, 10, { radius: 2 });
  t.road([[14, 44], [34, 40], [52, 38], [70, 34], [84, 30]], 3);

  t.base(0, 78, 28);
  t.base(1, 16, 42);
  t.structure('shipyard', 0, 80, 52, { key: 'corps-yard', facing: Math.PI });
  t.structure('coastalBattery', 0, 76, 54, { key: 'corps-battery', facing: Math.PI / 2 });
  t.structure('shipyard', 1, 14, 52, { key: 'coalition-yard', facing: 0 });
  t.structure('supplyDepot', 1, 24, 36, { key: 'coalition-depot' });
  t.structure('radar', -1, 46, 30);

  t.force(0, CORPS_ARMOUR, 78, 20);
  t.navalForce(0, ['missileBoat'], 82, 50);
  t.force(1, NATO_ARMOUR, 16, 34);
  t.navalForce(1, ['missileBoat'], 20, 50);
  t.force(1, ['atgm'], 30, 44);

  t.ore(86, 50, 3, 780);
  t.ore(10, 34, 3, 780);
  t.ore(48, 44, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps Coastal Column',
      factionId: 'russia',
      start: [78, 28],
      technologies: ['manoeuvre1', 'naval1', 'air1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires1', 'fires2', 'air2', 'naval2'],
        units: ['td', 'spg', 'rocketArtillery', 'fighter', 'attackHelo', 'frigate'],
      },
    },
    { name: 'Finnish Coastal Group', factionId: 'finland', start: [16, 42], isAI: true },
  ];
  return t.build(
    {
      id: 'coast-road',
      name: 'Coast Road — The Shore Push',
      description:
        'A shore road under naval gunfire, a headland overlooking it and two yards at the water.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x7081, startingMats: 3000, startingReq: 140, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 08 — Gun Line                                            */
/* ------------------------------------------------------------------ */

export const GUN_LINE_REGIONS = {
  line: { id: 'gun-line', name: 'Gun line', x: 50, z: 24, width: 16, height: 12 },
  revetments: { id: 'revetments', name: 'Revetments', x: 58, z: 36, width: 12, height: 10 },
  grid: { id: 'grid', name: 'Coalition grid', x: 28, z: 36, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** Siege artillery against a fortified grid: the North Korean contribution. */
export function createGunLine(): Scenario {
  const t = new Theatre(88, 64, 0x8192);
  t.scatter(Terrain.Farmland, 12, { radius: 3 });
  t.rect(30, 26, 26, 20, Terrain.Mud, 1);
  t.blob(46, 20, 5, Terrain.Rocks, 2);
  t.blob(24, 44, 6, Terrain.Forest, 1);
  // Coalition revetments: a fortified grid of hardpoints.
  for (let z = 30; z <= 44; z += 6) t.rect(28, z, 20, 2, Terrain.Sand, 1);
  for (let x = 28; x <= 46; x += 6) t.rect(x, 30, 2, 14, Terrain.Sand, 1);
  t.road([[12, 32], [30, 32], [50, 30], [76, 32]], 3);

  t.base(0, 74, 32);
  t.base(1, 12, 32);
  t.structure('bunker', 1, 32, 34, { key: 'coalition-bunker' });
  t.structure('bunker', 1, 40, 40);
  t.structure('mgNest', 1, 36, 30);
  t.structure('supplyDepot', 1, 20, 24, { key: 'coalition-depot' });

  t.force(0, [...CORPS_ARMOUR, 'spg', 'rocketArtillery'], 74, 24);
  t.force(1, [...NATO_ARMOUR, 'atgm', 'atgm'], 12, 24);
  t.force(1, ['rifle', 'rifle', 'medic'], 36, 36);

  t.ore(80, 46, 3, 780);
  t.ore(8, 46, 3, 780);
  t.ore(52, 50, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Korean Siege Group',
      factionId: 'northKorea',
      start: [74, 32],
      technologies: ['manoeuvre1', 'fires1', 'fires2'],
      restrictions: {
        technologies: ['manoeuvre2', 'air1', 'air2', 'naval1', 'naval2'],
        buildings: ['airfield', 'shipyard'],
        units: ['td', 'uav', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Polish Fortified Grid', factionId: 'poland', start: [12, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'gun-line',
      name: 'The Gun Line — Siege',
      description:
        'A fortified grid of hardpoints and a gun line behind it. Siege artillery is the only way through.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x8192, startingMats: 3000, startingReq: 150, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 09 — Winter Road                                         */
/* ------------------------------------------------------------------ */

export const WINTER_ROAD_REGIONS = {
  road: { id: 'winter-road', name: 'Winter road', x: 34, z: 28, width: 16, height: 14 },
  treeline: { id: 'treeline', name: 'Treeline', x: 18, z: 40, width: 14, height: 12 },
  depot: { id: 'depot', name: 'Forward depot', x: 48, z: 18, width: 12, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** A frozen road through deep forest: the corridor's winter operation. */
export function createWinterRoad(): Scenario {
  const t = new Theatre(84, 68, 0x92a3);
  t.scatter(Terrain.Forest, 28, { radius: 4 });
  t.scatter(Terrain.Marsh, 6, { radius: 2 });
  t.scatter(Terrain.Rocks, 6, { radius: 2, elevation: 2 });
  t.rect(40, 30, 4, 8, Terrain.Mud, 1);
  t.road([[40, 64], [40, 44], [42, 34], [40, 22], [38, 6]], 2);
  t.road([[42, 34], [60, 32], [72, 30]], 2);

  t.base(0, 40, 12);
  t.base(1, 40, 58);
  t.structure('supplyDepot', 1, 26, 44, { key: 'coalition-depot' });
  t.structure('watchtower', 0, 30, 24, { key: 'corps-tower' });
  t.structure('forwardPost', 1, 46, 40, { key: 'coalition-post' });

  t.force(0, [...CORPS_ARMOUR, 'uav'], 40, 20);
  t.force(1, [...NATO_ARMOUR, 'atgm'], 40, 50);
  t.force(1, ['rifle', 'atgm'], 30, 38);

  t.ore(52, 8, 3, 760);
  t.ore(28, 60, 3, 760);
  t.ore(20, 26, 3, 620);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps Winter Column',
      factionId: 'russia',
      start: [40, 12],
      technologies: ['manoeuvre1', 'manoeuvre2', 'air1'],
      restrictions: {
        technologies: ['fires1', 'fires2', 'air2', 'naval1', 'naval2'],
        buildings: ['shipyard'],
        units: ['spg', 'rocketArtillery', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Swedish Winter Group', factionId: 'sweden', start: [40, 58], isAI: true },
  ];
  return t.build(
    {
      id: 'winter-road',
      name: 'Winter Road — Frozen Corridor',
      description:
        'A single road through deep forest, frozen marsh either side and one forward depot at the end of it.',
      targetSize: 'medium',
    },
    players,
    {
      settings: {
        seed: 0x92a3,
        startingMats: 2600,
        startingReq: 120,
        fog: true,
        timeOfDay: 'dawn',
        startHour: 6,
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 10 — Depot War                                           */
/* ------------------------------------------------------------------ */

export const DEPOT_WAR_REGIONS = {
  northDepot: { id: 'north-depot', name: 'North depot', x: 32, z: 14, width: 14, height: 12 },
  southDepot: { id: 'south-depot', name: 'South depot', x: 42, z: 38, width: 14, height: 12 },
  silo: { id: 'silo', name: 'Grain silo', x: 58, z: 26, width: 11, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** A war of supply: two depots and a silo in open farmland. */
export function createDepotWar(): Scenario {
  const t = new Theatre(88, 64, 0xa3b4);
  t.scatter(Terrain.Farmland, 22, { radius: 4 });
  t.scatter(Terrain.Scrub, 8, { radius: 2 });
  t.blob(20, 20, 5, Terrain.Forest, 1);
  t.blob(70, 46, 5, Terrain.Forest, 1);
  t.rect(28, 18, 20, 10, Terrain.Industrial, 1);
  t.rect(38, 40, 20, 10, Terrain.Industrial, 1);
  t.road([[12, 32], [34, 30], [52, 32], [76, 32]], 3);
  t.road([[34, 30], [36, 20]], 2);
  t.road([[46, 32], [46, 44]], 2);

  t.base(0, 74, 32);
  t.base(1, 12, 32);
  t.structure('supplyDepot', -1, 36, 20, { key: 'north-depot' });
  t.structure('warehouse', -1, 42, 22);
  t.structure('supplyDepot', -1, 46, 42, { key: 'south-depot' });
  t.structure('freightShed', -1, 50, 44);
  t.structure('farmhouse', -1, 60, 28, { key: 'silo' });

  t.force(0, [...CORPS_ARMOUR, 'spg'], 74, 24);
  t.force(1, [...NATO_ARMOUR, 'atgm'], 12, 24);
  t.force(0, ['rifle', 'atgm'], 60, 40);
  t.force(1, ['rifle', 'atgm'], 30, 40);

  t.ore(80, 46, 3, 780);
  t.ore(8, 46, 3, 780);
  t.ore(24, 52, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Belarusian Supply Group',
      factionId: 'belarus',
      start: [74, 32],
      technologies: ['manoeuvre1', 'manoeuvre2', 'fires1', 'fires2'],
      restrictions: {
        technologies: ['air1', 'air2', 'naval1', 'naval2'],
        buildings: ['airfield', 'shipyard'],
        units: ['uav', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Polish Supply Group', factionId: 'poland', start: [12, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'depot-war',
      name: 'Depot War — Supply Lines',
      description:
        'Two depots, a silo and open farmland. Cutting supply matters more than holding ground.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xa3b4, startingMats: 3200, startingReq: 150, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 11 — Foundry Falls                                       */
/* ------------------------------------------------------------------ */

export const FOUNDRY_FALLS_REGIONS = {
  core: { id: 'core', name: 'Foundry core', x: 34, z: 20, width: 16, height: 16 },
  yards: { id: 'yards', name: 'North yards', x: 18, z: 36, width: 13, height: 11 },
  station: { id: 'station', name: 'Rail station', x: 54, z: 34, width: 13, height: 11 },
} as const satisfies Record<string, TheatreRegion>;

/** The city again, with everything committed: the corridor's decisive battle. */
export function createFoundryFalls(): Scenario {
  const t = new Theatre(88, 64, 0xb4c5);
  t.scatter(Terrain.Farmland, 6, { radius: 3, within: (x) => x < 18 || x > 70 });
  t.rect(18, 8, 58, 46, Terrain.Urban, 1);
  for (let x = 20; x < 76; x += 7) t.rect(x, 8, 2, 46, Terrain.Road, 1);
  for (let z = 10; z < 54; z += 7) t.rect(18, z, 58, 2, Terrain.Road, 1);
  t.rect(34, 20, 16, 16, Terrain.Industrial, 1);
  t.rect(54, 34, 13, 11, Terrain.Industrial, 1);
  t.rect(18, 36, 13, 11, Terrain.Urban, 1);
  t.blob(80, 12, 5, Terrain.Forest, 1);

  t.structure('foundryWorks', -1, 42, 28, { key: 'foundry-core' });
  t.structure('civicHall', -1, 30, 16, { key: 'city-hall' });
  t.structure('officeBlock', -1, 58, 26);
  t.structure('tenement', -1, 24, 44);
  t.structure('warehouse', -1, 60, 38, { key: 'station-depot' });
  t.structure('ruin', -1, 36, 44);

  t.base(0, 78, 32, { air: true });
  t.base(1, 10, 32, { air: true });

  t.force(0, [...CORPS_ARMOUR, 'spg', 'rocketArtillery', 'fighter'], 78, 24);
  t.force(1, [...NATO_ARMOUR, 'atgm', 'spg'], 10, 24);
  t.force(1, ['rifle', 'rifle', 'atgm'], 46, 30);
  t.force(0, ['rifle', 'atgm'], 64, 30);

  t.ore(84, 48, 3, 800);
  t.ore(6, 48, 3, 800);
  t.ore(42, 56, 3, 700);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps City Group',
      factionId: 'russia',
      start: [78, 32],
      technologies: [
        'manoeuvre1',
        'manoeuvre2',
        'fires1',
        'fires2',
        'air1',
        'air2',
        'naval1',
      ],
      restrictions: { technologies: ['naval2'], units: ['frigate', 'submarine'] },
    },
    { name: 'Polish City Group', factionId: 'poland', start: [10, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'foundry-falls',
      name: 'Foundry District — The City Falls',
      description:
        'A full city grid, the foundry core, the yards and the rail station, with air support on both sides.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xb4c5, startingMats: 3800, startingReq: 180, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* CORRIDOR / 12 — Straits Terms                                       */
/* ------------------------------------------------------------------ */

export const STRAITS_TERMS_REGIONS = {
  strait: { id: 'strait', name: 'Terms strait', x: 42, z: 26, width: 18, height: 16 },
  island: { id: 'island', name: 'Signal island', x: 28, z: 12, width: 14, height: 10 },
  base: { id: 'base', name: 'Coalition naval base', x: 14, z: 44, width: 14, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** The corridor's last operation: the strait that decides the campaign. */
export function createStraitsTerms(): Scenario {
  const t = new Theatre(100, 68, 0xc5d6);
  t.sea(
    (x, z) =>
      !(
        x > 66 ||
        x < 34 ||
        (x >= 38 && x <= 50 && z > 14 && z < 52) ||
        (x >= 26 && x <= 32 && z > 10 && z < 24)
      ) ||
      (z > 58 && x > 40),
  );
  t.disc(44, 34, 9, Terrain.Sand, 1);
  t.disc(30, 16, 6, Terrain.Rock, 2);
  t.blob(80, 22, 6, Terrain.Forest, 1);
  t.blob(86, 46, 5, Terrain.Scrub, 1);
  t.rect(70, 18, 16, 10, Terrain.Industrial, 1);

  t.base(0, 82, 34, { air: true });
  t.base(1, 18, 40, { air: true });
  t.structure('shipyard', 0, 69, 44, { key: 'corps-yard', facing: Math.PI });
  t.structure('shipyard', 1, 31, 48, { key: 'coalition-yard', facing: 0 });
  t.structure('coastalBattery', 0, 68, 50, { key: 'corps-battery', facing: Math.PI });
  t.structure('coastalBattery', 1, 33, 44, { key: 'coalition-battery', facing: 0 });
  t.structure('radarStation', 1, 30, 14, { key: 'signal-island' });
  t.structure('supplyDepot', 1, 14, 50, { key: 'coalition-depot' });

  t.force(0, [...CORPS_ARMOUR, 'fighter'], 82, 26);
  t.navalForce(0, ['corvette', 'frigate'], 72, 40);
  t.force(1, [...NATO_ARMOUR, 'fighter'], 18, 32);
  t.navalForce(1, ['corvette', 'frigate'], 28, 40);
  t.navalForce(1, ['missileBoat', 'missileBoat'], 30, 44);
  t.force(0, ['atgm'], 64, 40);
  t.navalForce(0, ['missileBoat'], 64, 44);

  t.ore(88, 52, 3, 820);
  t.ore(8, 34, 3, 820);
  t.ore(44, 22, 3, 700);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Corps Coastal Command',
      factionId: 'russia',
      start: [82, 34],
      technologies: [
        'manoeuvre1',
        'manoeuvre2',
        'fires1',
        'fires2',
        'air1',
        'air2',
        'naval1',
        'naval2',
      ],
    },
    { name: 'Coalition Straits Command', factionId: 'uk', start: [18, 40], isAI: true },
  ];
  return t.build(
    {
      id: 'straits-terms',
      name: 'Kestrel Straits — Terms',
      description:
        'The last strait: two naval bases, a signal island, and enough air and sea power to close the campaign.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xc5d6, startingMats: 4200, startingReq: 210, fog: true } },
  );
}

/** Eastern theatre registry, in campaign order. */
export const EASTERN_THEATRES: Readonly<Record<string, () => Scenario>> = Object.freeze({
  'red-beach': createRedBeach,
  'foundry-pocket': createFoundryPocket,
  'strait-blockade': createStraitBlockade,
  'iron-column': createIronColumn,
  'drone-line': createDroneLine,
  'kestrel-reach': createKestrelReach,
  'coast-road': createCoastRoad,
  'gun-line': createGunLine,
  'winter-road': createWinterRoad,
  'depot-war': createDepotWar,
  'foundry-falls': createFoundryFalls,
  'straits-terms': createStraitsTerms,
});
