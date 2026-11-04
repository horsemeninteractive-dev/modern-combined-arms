/**
 * Baltic Line theatres.
 *
 * One map per operation, authored for that operation only: the ground, the
 * deployment areas, the starting force and the terrain the objectives sit on
 * are all part of the mission design. Nothing here is offered to skirmish or
 * multiplayer; the campaign is the only caller.
 *
 * Every map names its own landmark rectangles. The mission documents import
 * those constants rather than repeating tile numbers, so a region and the
 * ground it describes can never drift apart.
 */
import { Terrain } from '../../sim/terrain';
import type { Scenario } from '../../sim/scenario';
import { Theatre, type TheatrePlayerSpec } from './theatre';

export interface TheatreRegion {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  height: number;
}

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

/* ------------------------------------------------------------------ */
/* BALTIC / 01 — Kestrel Beachhead                                     */
/* ------------------------------------------------------------------ */

export const KESTREL_BEACH_REGIONS = {
  beachhead: {
    id: 'beachhead',
    name: 'Beachhead line',
    x: 14,
    z: 30,
    width: 18,
    height: 16,
  },
  village: { id: 'village', name: 'Village crossroads', x: 39, z: 24, width: 11, height: 10 },
  pass: { id: 'ridge-pass', name: 'Ridge pass', x: 48, z: 31, width: 9, height: 8 },
} as const satisfies Record<string, TheatreRegion>;

/**
 * The coalition landing ground: sea to the west and south, the beach, the
 * village at the western mouth of the pass, and the corps plateau beyond.
 */
export function createKestrelBeach(): Scenario {
  const t = new Theatre(96, 72, 0x1d0e);
  t.sea(
    (x, z) =>
      x < 12 ||
      z > 56 ||
      z < 6 ||
      (x > 86 && z > 44) ||
      (x > 62 && x < 74 && z > 50),
  );
  // The corps plateau the east half of the map stands on.
  t.rect(58, 8, 30, 44, Terrain.Grass, 2);
  t.scatter(Terrain.Forest, 14, { radius: 3, within: (x) => x > 24 });
  t.scatter(Terrain.Scrub, 10, { radius: 2, within: (x) => x > 30 && x < 82 });
  t.disc(30, 46, 6, Terrain.Marsh);

  // One armour pass through the ridge; the northern spur stays a wall.
  t.ridge([[50, 6], [50, 30]], 3);
  t.ridge([[50, 43], [50, 55]], 3);
  t.ridge([[50, 30], [58, 16]], 2);

  // The village straddles the western mouth of the pass.
  t.rect(40, 25, 9, 8, Terrain.Urban, 1);
  t.rect(42, 27, 3, 2, Terrain.Road, 1);
  t.structure('relay', -1, 44, 28, { key: 'village-relay' });
  t.structure('tenement', -1, 41, 26);
  t.structure('warehouse', -1, 46, 30);

  // Road: beachhead, village, pass, plateau.
  t.road([[22, 42], [34, 36], [43, 31], [52, 35], [62, 30], [74, 24]], 3);
  t.road([[44, 31], [44, 40]], 2);

  t.base(0, 30, 42);
  t.base(1, 74, 24, { defences: true });
  t.structure('supplyDepot', 1, 66, 16, { key: 'corps-depot' });
  t.structure('radarStation', 1, 80, 34, { key: 'corps-radar' });

  t.force(0, NATO_LIGHT, 22, 46);
  t.force(1, [...CORPS_LIGHT, 'tank'], 66, 30);

  t.ore(18, 50, 3, 820);
  t.ore(82, 32, 3, 820);
  t.ore(36, 50, 3, 700);

  // The opening operation is fought with what came ashore first: infantry, a
  // reconnaissance troop and engineers. No armour, no guns, no air, no yard,
  // and no research centre to unlock any of them. The later operations hand the
  // commander each of those capabilities in turn.
  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Lithuanian Battlegroup',
      factionId: 'lithuania',
      start: [24, 44],
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
        units: [
          'tank',
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
    { name: '11th Corps Battlegroup', factionId: 'russia', start: [74, 24], isAI: true },
  ];
  return t.build(
    {
      id: 'kestrel-beach',
      name: 'Kestrel Bay — Beachhead',
      description:
        'A coalition landing on the western beach, the ridge pass that splits the bay, and the corps plateau beyond it.',
      targetSize: 'large',
    },
    players,
    {
      settings: {
        seed: 0x1d0e,
        startingMats: 2200,
        startingReq: 90,
        fog: true,
        // Strategy is introduced in the later operations: this landing is
        // fought with the force that came ashore first, and no strategic
        // call-in is available to either side.
        superweapons: false,
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 02 — Rust Pass                                             */
/* ------------------------------------------------------------------ */

export const RUST_PASS_REGIONS = {
  northPass: { id: 'north-pass', name: 'North pass', x: 38, z: 12, width: 12, height: 10 },
  southPass: { id: 'south-pass', name: 'South pass', x: 38, z: 42, width: 12, height: 10 },
  depot: { id: 'depot', name: 'Forward depot', x: 54, z: 28, width: 11, height: 11 },
} as const satisfies Record<string, TheatreRegion>;

/** Two armoured passes through a central massif of broken rock. */
export function createRustPass(): Scenario {
  const t = new Theatre(88, 64, 0x2b17);
  t.scatter(Terrain.Farmland, 12, { radius: 3 });
  t.scatter(Terrain.Scrub, 14, { radius: 2 });
  t.scatter(Terrain.Forest, 10, { radius: 3, within: (x) => x < 30 || x > 58 });

  // The central massif: high rock, split by two passes wide enough for armour.
  t.ridge([[44, 2], [44, 20]], 4);
  t.ridge([[44, 30], [44, 38]], 4);
  t.ridge([[44, 48], [44, 62]], 4);
  t.ridge([[44, 20], [38, 14]], 2);
  t.ridge([[44, 38], [50, 44]], 2);
  // Rocky shoulders, so the passes are the only clean routes.
  t.blob(34, 26, 5, Terrain.Rocks, 2);
  t.blob(56, 40, 5, Terrain.Rocks, 2);

  t.road([[14, 32], [30, 32], [40, 17], [58, 16], [74, 30]], 3);
  t.road([[14, 32], [28, 36], [40, 47], [58, 46], [74, 30]], 3);
  t.road([[44, 17], [50, 24], [52, 32]], 2);

  t.base(0, 18, 32);
  t.base(1, 72, 32);
  t.structure('supplyDepot', 1, 60, 22, { key: 'belarus-depot' });
  t.structure('ruin', -1, 52, 34);
  t.structure('warehouse', -1, 48, 30);

  t.force(0, NATO_ARMOUR, 18, 24);
  t.force(1, CORPS_ARMOUR, 72, 24);
  t.force(1, ['atgm', 'atgm'], 52, 32);
  t.force(1, ['atgm'], 50, 44);

  t.ore(12, 40, 3, 800);
  t.ore(78, 22, 3, 800);
  t.ore(30, 50, 3, 640);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Polish Armoured Battlegroup',
      factionId: 'poland',
      start: [18, 32],
      technologies: ['manoeuvre1'],
      restrictions: {
        technologies: [
          'manoeuvre2',
          'fires1',
          'fires2',
          'air1',
          'air2',
          'naval1',
          'naval2',
        ],
        buildings: ['airfield', 'shipyard'],
        units: ['td', 'spg', 'rocketArtillery', 'uav', 'interceptor', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Belarusian Armoured Group', factionId: 'belarus', start: [72, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'rust-pass',
      name: 'Rust Valley — The Two Passes',
      description:
        'Polish armour against a Belarusian group dug into a broken massif. Two passes decide who owns the eastern plain.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x2b17, startingMats: 2600, startingReq: 110, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 03 — Strait Denial                                         */
/* ------------------------------------------------------------------ */

export const STRAIT_DENIAL_REGIONS = {
  channel: { id: 'channel', name: 'Main channel', x: 38, z: 24, width: 20, height: 14 },
  radar: { id: 'radar-isle', name: 'Radar isle', x: 56, z: 10, width: 12, height: 10 },
  anchorage: { id: 'anchorage', name: 'Eastern anchorage', x: 68, z: 40, width: 14, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** Island chain and a deep channel: a naval operation with ground lodgements. */
export function createStraitDenial(): Scenario {
  const t = new Theatre(96, 64, 0x3c21);
  t.sea(
    (x, z) =>
      !(x < 26 || x > 70 || (x >= 40 && x <= 56 && z > 18 && z < 44)) ||
      (z > 52 && x < 60),
  );
  t.disc(48, 30, 7, Terrain.Grass, 1);
  t.disc(60, 16, 6, Terrain.Rock, 2);
  t.blob(20, 20, 5, Terrain.Forest, 1);
  t.blob(78, 24, 5, Terrain.Forest, 1);
  t.scatter(Terrain.Sand, 6, { radius: 2 });
  t.road([[12, 34], [22, 34], [30, 30]], 2);
  t.road([[72, 32], [80, 34], [86, 34]], 2);

  t.base(0, 16, 34);
  t.base(1, 80, 32);
  // The yards sit on the inner coast, facing the channel.
  t.structure('shipyard', 0, 23, 34, { key: 'own-yard', facing: 0 });
  t.structure('shipyard', 1, 73, 30, { key: 'corps-yard', facing: Math.PI });
  t.structure('coastalBattery', 1, 72, 44, { key: 'corps-battery', facing: Math.PI / 2 });
  t.structure('coastalBattery', 0, 25, 30, { key: 'own-battery', facing: 0 });
  t.structure('radarStation', 1, 60, 16, { key: 'isle-radar' });

  t.force(0, NATO_LIGHT, 16, 26);
  t.navalForce(0, ['missileBoat'], 24, 36);
  t.force(1, CORPS_LIGHT, 80, 26);
  t.navalForce(1, ['corvette'], 72, 34);
  t.navalForce(1, ['missileBoat'], 66, 44);

  t.ore(10, 24, 3, 800);
  t.ore(86, 22, 3, 800);
  t.ore(46, 26, 2, 420);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'UK Littoral Task Force',
      factionId: 'uk',
      start: [16, 34],
      technologies: ['naval1', 'manoeuvre1'],
      restrictions: {
        technologies: ['naval2', 'manoeuvre2', 'fires1', 'fires2', 'air1', 'air2'],
        buildings: ['airfield'],
        units: ['td', 'spg', 'rocketArtillery', 'uav', 'interceptor', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Corps Coastal Group', factionId: 'russia', start: [80, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'strait-denial',
      name: 'Kestrel Straits — Channel Denial',
      description:
        'An island chain, a deep channel and two yards. Whoever holds the channel holds the corps sea lane.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x3c21, startingMats: 2400, startingReq: 120, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 04 — Lapland Watch                                         */
/* ------------------------------------------------------------------ */

export const LAPLAND_WATCH_REGIONS = {
  treeline: { id: 'treeline', name: 'Treeline', x: 22, z: 26, width: 18, height: 12 },
  crossing: { id: 'crossing', name: 'Ice crossing', x: 36, z: 30, width: 10, height: 10 },
  depot: { id: 'depot', name: 'Forward depot', x: 48, z: 16, width: 11, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** Winter forest at night: a Finnish screen against a corps night march. */
export function createLaplandWatch(): Scenario {
  const t = new Theatre(80, 72, 0x4d2e);
  t.scatter(Terrain.Forest, 26, { radius: 4 });
  t.scatter(Terrain.Marsh, 8, { radius: 3 });
  t.scatter(Terrain.Rocks, 8, { radius: 2, elevation: 2 });
  t.disc(40, 34, 7, Terrain.Forest, 1);
  t.disc(40, 34, 3, Terrain.Mud, 1);

  // One road north to south, one logging track east.
  t.road([[40, 66], [40, 44], [38, 34], [42, 22], [40, 6]], 2);
  t.road([[38, 34], [56, 30], [70, 30]], 2);

  t.base(0, 40, 60);
  t.base(1, 40, 12);
  t.structure('watchtower', 0, 26, 40, { key: 'own-tower' });
  t.structure('supplyDepot', 1, 52, 16, { key: 'corps-depot' });
  t.structure('forwardPost', 1, 44, 24, { key: 'corps-post' });

  t.force(0, [...NATO_LIGHT, 'uav'], 34, 55);
  t.force(1, [...CORPS_LIGHT, 'ifv'], 46, 18);
  t.force(1, ['rifle', 'atgm'], 30, 26);

  t.ore(30, 58, 3, 760);
  t.ore(52, 12, 3, 760);
  t.ore(24, 28, 3, 620);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Finnish Jaeger Battlegroup',
      factionId: 'finland',
      start: [40, 58],
      technologies: ['manoeuvre1', 'air1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires1', 'fires2', 'air2', 'naval1', 'naval2'],
        buildings: ['shipyard'],
        units: ['td', 'spg', 'rocketArtillery', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Corps Night Column', factionId: 'russia', start: [40, 12], isAI: true },
  ];
  return t.build(
    {
      id: 'lapland-watch',
      name: 'Lapland — Night Watch',
      description:
        'A forest road, an ice crossing and a corps column moving in the dark. No armour support, no artillery, one drone.',
      targetSize: 'medium',
    },
    players,
    {
      settings: {
        seed: 0x4d2e,
        startingMats: 2000,
        startingReq: 90,
        fog: true,
        timeOfDay: 'night',
        startHour: 22,
        dayLengthMinutes: 0,
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 05 — Foundry Relief                                        */
/* ------------------------------------------------------------------ */

export const FOUNDRY_RELIEF_REGIONS = {
  foundry: { id: 'foundry', name: 'Foundry works', x: 36, z: 24, width: 14, height: 14 },
  railyard: { id: 'railyard', name: 'Rail yard', x: 54, z: 34, width: 13, height: 11 },
  oldtown: { id: 'oldtown', name: 'Old town', x: 24, z: 16, width: 13, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** Dense city grid: the foundry city, relieved from the west. */
export function createFoundryRelief(): Scenario {
  const t = new Theatre(88, 64, 0x5e35);
  t.scatter(Terrain.Farmland, 8, { radius: 3, within: (x) => x < 24 || x > 64 });
  t.rect(20, 12, 52, 40, Terrain.Urban, 1);
  // Street grid carved out of the blocks.
  for (let x = 22; x < 70; x += 8) t.rect(x, 12, 2, 40, Terrain.Road, 1);
  for (let z = 14; z < 50; z += 8) t.rect(20, z, 52, 2, Terrain.Road, 1);
  t.rect(36, 24, 14, 14, Terrain.Industrial, 1);
  t.rect(54, 34, 13, 11, Terrain.Industrial, 1);
  t.rect(24, 16, 13, 12, Terrain.DenseUrban, 1);
  t.blob(16, 52, 6, Terrain.Forest, 1);
  t.blob(74, 12, 5, Terrain.Scrub, 1);

  t.structure('foundryWorks', -1, 43, 30, { key: 'foundry-works' });
  t.structure('tenement', -1, 28, 40);
  t.structure('tenement', -1, 32, 20);
  t.structure('officeBlock', -1, 60, 22);
  t.structure('warehouse', 1, 58, 38, { key: 'rail-depot' });
  t.structure('civicHall', -1, 30, 22);

  t.base(0, 14, 32);
  t.base(1, 76, 32);

  t.force(0, NATO_ARMOUR, 14, 24);
  t.force(1, [...CORPS_ARMOUR, 'atgm'], 76, 24);
  t.force(1, ['rifle', 'rifle', 'medic'], 48, 30);

  t.ore(10, 44, 3, 780);
  t.ore(80, 48, 3, 780);
  t.ore(48, 54, 3, 620);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Polish Relief Column',
      factionId: 'poland',
      start: [14, 32],
      technologies: ['manoeuvre1', 'fires1', 'air1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires2', 'air2', 'naval1', 'naval2'],
        buildings: ['shipyard'],
        units: ['td', 'rocketArtillery', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Belarusian City Group', factionId: 'belarus', start: [76, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'foundry-relief',
      name: 'Foundry District — Relief Column',
      description:
        'A dense industrial city held by a Belarusian group. The rail yard and the foundry works are the decisive ground.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x5e35, startingMats: 2800, startingReq: 130, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 06 — Granite Steps                                         */
/* ------------------------------------------------------------------ */

export const GRANITE_STEPS_REGIONS = {
  lower: { id: 'lower-step', name: 'Lower step', x: 24, z: 36, width: 14, height: 11 },
  upper: { id: 'upper-step', name: 'Upper step', x: 44, z: 20, width: 14, height: 11 },
  quarry: { id: 'quarry', name: 'Quarry', x: 54, z: 40, width: 11, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** Terraced uplands: three steps of rock with worn passes between them. */
export function createGraniteSteps(): Scenario {
  const t = new Theatre(84, 68, 0x6f3c);
  t.scatter(Terrain.Scrub, 10, { radius: 2 });
  // Three terraces, each edge broken by a pass.
  t.ridge([[8, 48], [34, 48]], 3);
  t.ridge([[44, 48], [76, 48]], 3);
  t.ridge([[14, 32], [36, 32]], 3);
  t.ridge([[46, 32], [74, 32]], 3);
  t.rect(20, 36, 24, 10, Terrain.Rocks, 2);
  t.rect(42, 20, 26, 10, Terrain.Rocks, 2);
  t.blob(30, 24, 5, Terrain.Rock, 2);
  t.blob(58, 54, 5, Terrain.Rock, 2);

  t.road([[12, 58], [40, 52], [40, 44], [52, 36], [52, 28], [64, 22], [70, 10]], 2);
  t.road([[40, 52], [66, 58], [74, 62]], 2);

  t.structure('ruin', -1, 58, 44, { key: 'quarry' });
  t.structure('watchtower', -1, 52, 46);
  t.base(0, 16, 54);
  t.base(1, 66, 14);

  t.force(0, NATO_ARMOUR, 18, 46);
  t.force(1, [...CORPS_ARMOUR, 'atgm'], 64, 22);
  t.force(1, ['atgm'], 52, 36);

  t.ore(10, 60, 3, 780);
  t.ore(74, 46, 3, 780);
  t.ore(30, 40, 3, 600);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Swedish Armoured Group',
      factionId: 'sweden',
      start: [16, 54],
      technologies: ['manoeuvre1', 'manoeuvre2', 'fires1'],
      restrictions: {
        technologies: ['fires2', 'air2', 'naval1', 'naval2'],
        units: ['rocketArtillery', 'fighter', 'attackHelo', 'missileBoat', 'corvette'],
      },
    },
    { name: 'Corps Mountain Group', factionId: 'russia', start: [66, 14], isAI: true },
  ];
  return t.build(
    {
      id: 'granite-steps',
      name: 'Granite Steps — The Terraces',
      description:
        'Three terraces of broken granite, each with one worn pass. Guns on the upper step see most of the field.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x6f3c, startingMats: 2800, startingReq: 130, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 07 — Amber Coast                                           */
/* ------------------------------------------------------------------ */

export const AMBER_COAST_REGIONS = {
  harbour: { id: 'harbour', name: 'Harbour', x: 16, z: 40, width: 13, height: 11 },
  dunes: { id: 'dunes', name: 'Dune belt', x: 36, z: 12, width: 16, height: 12 },
  road: { id: 'coast-road', name: 'Coast road', x: 44, z: 34, width: 16, height: 9 },
} as const satisfies Record<string, TheatreRegion>;

/** Coastal combination: a harbour, a dune belt and a shore road. */
export function createAmberCoast(): Scenario {
  const t = new Theatre(96, 64, 0x7a44);
  t.sea((x, z) => x < 10 || x > 90 || z > 56 || (x < 22 && z > 50));
  t.rect(12, 40, 20, 12, Terrain.Sand, 1);
  t.blob(40, 18, 9, Terrain.Dune, 2);
  t.blob(60, 36, 7, Terrain.Scrub, 1);
  t.scatter(Terrain.Forest, 10, { radius: 3, within: (x, z) => x > 30 && z > 40 });

  t.road([[16, 44], [34, 40], [50, 38], [66, 34], [82, 30]], 3);
  t.road([[40, 20], [46, 34]], 2);

  t.base(0, 26, 44);
  t.base(1, 78, 28);
  t.structure('shipyard', 0, 14, 46, { key: 'own-yard', facing: 0 });
  t.structure('shipyard', 1, 88, 40, { key: 'corps-yard', facing: Math.PI });
  t.structure('coastalBattery', 1, 90, 46, { key: 'corps-battery', facing: Math.PI / 2 });
  t.structure('supplyDepot', 1, 66, 22, { key: 'corps-depot' });
  t.structure('radar', 1, 72, 18);

  t.force(0, NATO_ARMOUR, 26, 36);
  t.navalForce(0, ['missileBoat'], 14, 44);
  t.force(1, CORPS_ARMOUR, 78, 20);
  t.navalForce(1, ['corvette'], 86, 40);
  t.navalForce(1, ['missileBoat', 'missileBoat'], 86, 44);

  t.ore(14, 52, 3, 800);
  t.ore(86, 24, 3, 800);
  t.ore(52, 46, 3, 700);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Lithuanian Coastal Group',
      factionId: 'lithuania',
      start: [26, 44],
      technologies: ['manoeuvre1', 'manoeuvre2', 'fires1', 'naval1', 'air1'],
      restrictions: {
        technologies: ['fires2', 'air2', 'naval2'],
        units: ['rocketArtillery', 'fighter', 'attackHelo', 'frigate', 'submarine'],
      },
    },
    { name: 'Corps Coastal Group', factionId: 'russia', start: [78, 28], isAI: true },
  ];
  return t.build(
    {
      id: 'amber-coast',
      name: 'Amber Coast — The Harbour',
      description:
        'A sand coast, a dune belt and a shore road. Two yards and a coastal battery cover the anchorage.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x7a44, startingMats: 3000, startingReq: 140, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 08 — Signal Hill                                           */
/* ------------------------------------------------------------------ */

export const SIGNAL_HILL_REGIONS = {
  hill: { id: 'signal-hill', name: 'Signal hill', x: 36, z: 18, width: 16, height: 14 },
  valley: { id: 'valley', name: 'Northern valley', x: 40, z: 38, width: 14, height: 11 },
  airstrip: { id: 'airstrip', name: 'Forward airstrip', x: 22, z: 42, width: 13, height: 11 },
} as const satisfies Record<string, TheatreRegion>;

/** Air war over a radar hill: both sides operate from forward strips. */
export function createSignalHill(): Scenario {
  const t = new Theatre(88, 64, 0x8b4d);
  t.scatter(Terrain.Farmland, 12, { radius: 3 });
  t.scatter(Terrain.Forest, 10, { radius: 3 });
  // One dominant hill with a radar crown and steep shoulders.
  t.disc(44, 24, 12, Terrain.Grass, 2);
  t.disc(44, 24, 11, Terrain.Rocks, 2);
  t.disc(44, 24, 8, Terrain.Rock, 3);
  t.disc(44, 24, 4, Terrain.Grass, 3);
  t.ridge([[20, 34], [36, 32]], 2);
  t.ridge([[52, 32], [70, 34]], 2);

  t.road([[12, 34], [30, 34], [40, 28], [56, 34], [76, 32]], 3);
  t.road([[44, 12], [44, 6]], 2);

  t.base(0, 14, 34, { air: true });
  t.base(1, 74, 34, { air: true });
  t.structure('radarStation', -1, 44, 22, { key: 'hill-radar' });
  t.structure('watchtower', -1, 40, 30);
  t.structure('samBattery', 1, 66, 24);
  t.structure('samBattery', 0, 24, 44);

  t.force(0, [...NATO_ARMOUR, 'interceptor', 'fighter'], 14, 26);
  t.force(1, [...CORPS_ARMOUR, 'interceptor', 'fighter'], 74, 26);
  t.force(1, ['atgm', 'atgm'], 44, 30);

  t.ore(10, 46, 3, 780);
  t.ore(80, 46, 3, 780);
  t.ore(66, 54, 3, 640);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'UK Expeditionary Air Group',
      factionId: 'uk',
      start: [14, 34],
      technologies: ['manoeuvre1', 'manoeuvre2', 'fires1', 'air1', 'air2'],
      restrictions: {
        technologies: ['fires2', 'naval1', 'naval2'],
        units: ['rocketArtillery', 'missileBoat', 'corvette', 'frigate'],
      },
    },
    { name: 'Corps Air Group', factionId: 'russia', start: [74, 34], isAI: true },
  ];
  return t.build(
    {
      id: 'signal-hill',
      name: 'Signal Hill — Air War',
      description:
        'A radar crown on one hill, two forward strips and a valley road. Whoever owns the hill sees the airspace.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x8b4d, startingMats: 3200, startingReq: 150, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 09 — Convoy Lane                                           */
/* ------------------------------------------------------------------ */

export const CONVOY_LANE_REGIONS = {
  lane: { id: 'lane', name: 'Convoy lane', x: 36, z: 10, width: 26, height: 10 },
  beach: { id: 'beach', name: 'Landing beach', x: 22, z: 28, width: 15, height: 12 },
  anchorage: { id: 'anchorage', name: 'Anchorage', x: 66, z: 44, width: 15, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** Escort ground: a sea lane along the north coast and a landing beach. */
export function createConvoyLane(): Scenario {
  const t = new Theatre(96, 64, 0x9c56);
  t.sea((x, z) => z < 12 || x < 8 || z > 54);
  t.rect(10, 12, 30, 10, Terrain.Sand, 1);
  t.blob(30, 30, 8, Terrain.Forest, 1);
  t.blob(64, 24, 9, Terrain.Scrub, 1);
  t.scatter(Terrain.Farmland, 10, { radius: 3 });
  t.road([[18, 34], [42, 30], [64, 34], [84, 30]], 3);

  t.base(0, 18, 40);
  t.base(1, 78, 30);
  t.structure('shipyard', 0, 16, 14, { key: 'own-yard', facing: Math.PI / 2 });
  t.structure('shipyard', 1, 84, 52, { key: 'corps-yard', facing: Math.PI });
  t.structure('coastalBattery', 1, 74, 54, { key: 'corps-battery', facing: Math.PI / 2 });
  t.structure('relay', -1, 48, 28, { key: 'lane-relay' });
  t.structure('supplyDepot', 0, 24, 34, { key: 'convoy-depot' });

  t.force(0, NATO_LIGHT, 18, 32);
  t.navalForce(0, ['missileBoat', 'corvette'], 18, 16);
  t.force(1, CORPS_LIGHT, 78, 22);
  t.navalForce(1, ['missileBoat', 'corvette'], 82, 50);
  t.navalForce(1, ['corvette'], 88, 34);

  t.ore(12, 44, 3, 780);
  t.ore(84, 44, 3, 780);
  t.ore(50, 40, 3, 640);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Finnish Escort Group',
      factionId: 'finland',
      start: [18, 40],
      technologies: ['manoeuvre1', 'naval1', 'naval2', 'air1'],
      restrictions: {
        technologies: ['manoeuvre2', 'fires1', 'fires2', 'air2'],
        units: ['td', 'spg', 'rocketArtillery', 'fighter', 'attackHelo'],
      },
    },
    { name: 'Corps Interdiction Group', factionId: 'russia', start: [78, 30], isAI: true },
  ];
  return t.build(
    {
      id: 'convoy-lane',
      name: 'Convoy Lane — Northern Passage',
      description:
        'A coastal sea lane, a landing beach and one anchorage. The escort has to hold the lane open.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0x9c56, startingMats: 3000, startingReq: 140, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 10 — Rail Junction                                         */
/* ------------------------------------------------------------------ */

export const RAIL_JUNCTION_REGIONS = {
  junction: { id: 'junction', name: 'Rail junction', x: 38, z: 24, width: 14, height: 13 },
  yards: { id: 'yards', name: 'Freight yards', x: 22, z: 40, width: 13, height: 11 },
  depot: { id: 'depot', name: 'Supply depot', x: 54, z: 36, width: 11, height: 10 },
} as const satisfies Record<string, TheatreRegion>;

/** Farmland and freight: the junction that feeds the whole corridor. */
export function createRailJunction(): Scenario {
  const t = new Theatre(88, 64, 0xad5f);
  t.scatter(Terrain.Farmland, 18, { radius: 4, within: (_x, z) => z < 22 || z > 44 });
  t.scatter(Terrain.Forest, 8, { radius: 3, within: (x) => x < 22 || x > 66 });
  t.rect(30, 18, 28, 20, Terrain.Industrial, 1);
  t.rect(20, 38, 16, 12, Terrain.Industrial, 1);
  // The rail lines themselves.
  t.rect(6, 27, 76, 2, Terrain.Road, 1);
  t.rect(42, 6, 2, 52, Terrain.Road, 1);
  t.road([[14, 32], [30, 32], [44, 30], [60, 32], [74, 32]], 2);

  t.structure('warehouse', -1, 36, 22, { key: 'junction-shed' });
  t.structure('freightShed', -1, 48, 22);
  t.structure('warehouse', 1, 60, 36, { key: 'depot-store' });
  t.structure('radar', -1, 46, 30);

  t.base(0, 14, 32);
  t.base(1, 74, 32);

  t.force(0, [...NATO_ARMOUR, 'spg'], 14, 24);
  t.force(1, [...CORPS_ARMOUR, 'rocketArtillery'], 74, 24);
  t.force(1, ['rifle', 'atgm'], 52, 26);

  t.ore(10, 46, 3, 780);
  t.ore(80, 46, 3, 780);
  t.ore(30, 52, 3, 660);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Polish Rail Group',
      factionId: 'poland',
      start: [14, 32],
      technologies: ['manoeuvre1', 'manoeuvre2', 'fires1', 'fires2', 'air1'],
      restrictions: {
        technologies: ['air2', 'naval1', 'naval2'],
        units: ['fighter', 'attackHelo', 'missileBoat', 'corvette', 'frigate'],
      },
    },
    { name: 'Belarusian Rail Group', factionId: 'belarus', start: [74, 32], isAI: true },
  ];
  return t.build(
    {
      id: 'rail-junction',
      name: 'Rail Junction — The Freight War',
      description:
        'A junction, freight yards and a supply depot in open farmland. Both sides can reach it; only one can hold it.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xad5f, startingMats: 3200, startingReq: 150, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 11 — Corridor Break                                        */
/* ------------------------------------------------------------------ */

export const CORRIDOR_BREAK_REGIONS = {
  corridor: { id: 'corridor', name: 'Corridor', x: 36, z: 22, width: 18, height: 20 },
  gate: { id: 'ridge-gate', name: 'Ridge gate', x: 30, z: 12, width: 12, height: 10 },
  rear: { id: 'rear-area', name: 'Rear area', x: 58, z: 40, width: 13, height: 11 },
} as const satisfies Record<string, TheatreRegion>;

/** The wide corridor between two ridge systems: the coalition's counter-stroke. */
export function createCorridorBreak(): Scenario {
  const t = new Theatre(92, 68, 0xbe68);
  t.scatter(Terrain.Farmland, 14, { radius: 4 });
  t.scatter(Terrain.Forest, 12, { radius: 3 });
  t.ridge([[26, 4], [26, 22]], 3);
  t.ridge([[26, 34], [26, 64]], 3);
  t.ridge([[62, 4], [62, 24]], 3);
  t.ridge([[62, 38], [62, 64]], 3);
  t.blob(44, 32, 7, Terrain.Urban, 1);
  t.blob(80, 14, 6, Terrain.Rocks, 2);

  t.road([[10, 34], [26, 30], [44, 32], [62, 30], [84, 34]], 3);
  t.road([[44, 32], [44, 10]], 2);
  t.road([[44, 32], [44, 58]], 2);

  t.base(0, 14, 34);
  t.base(1, 80, 34, { air: true });
  t.structure('relay', -1, 44, 32, { key: 'corridor-relay' });
  t.structure('supplyDepot', 1, 72, 24, { key: 'corps-depot' });

  t.force(0, [...NATO_ARMOUR, 'spg', 'td'], 16, 26);
  t.force(1, [...CORPS_ARMOUR, 'rocketArtillery'], 78, 26);
  t.force(1, ['rifle', 'atgm'], 62, 34);
  t.structure('mgNest', 1, 66, 30);

  t.ore(10, 50, 3, 800);
  t.ore(84, 48, 3, 800);
  t.ore(40, 46, 4, 700);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'Swedish Breakthrough Group',
      factionId: 'sweden',
      start: [14, 34],
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
    { name: 'Corps Corridor Group', factionId: 'russia', start: [80, 34], isAI: true },
  ];
  return t.build(
    {
      id: 'corridor-break',
      name: 'The Corridor — Breakthrough',
      description:
        'A wide corridor between two ridge systems, a relay at the centre and the corps rear area beyond.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xbe68, startingMats: 3600, startingReq: 170, fog: true } },
  );
}

/* ------------------------------------------------------------------ */
/* BALTIC / 12 — Kestrel Straits                                       */
/* ------------------------------------------------------------------ */

export const STRAITS_FINAL_REGIONS = {
  strait: { id: 'strait', name: 'The straits', x: 40, z: 26, width: 18, height: 16 },
  islands: { id: 'islands', name: 'Outer islands', x: 58, z: 12, width: 14, height: 11 },
  navalBase: { id: 'naval-base', name: 'Corps naval base', x: 70, z: 44, width: 14, height: 12 },
} as const satisfies Record<string, TheatreRegion>;

/** The finale: a wide strait, two island groups and the corps naval base. */
export function createStraitsFinal(): Scenario {
  const t = new Theatre(100, 68, 0xcf70);
  t.sea(
    (x, z) =>
      !(
        x < 30 ||
        x > 68 ||
        (x >= 36 && x <= 50 && z > 14 && z < 52) ||
        (x >= 58 && x <= 64 && z > 10 && z < 24)
      ) ||
      (z > 58 && x < 62),
  );
  t.disc(44, 34, 9, Terrain.Grass, 1);
  t.disc(60, 18, 6, Terrain.Rock, 2);
  t.blob(20, 22, 6, Terrain.Forest, 1);
  t.blob(80, 22, 6, Terrain.Forest, 1);
  t.rect(14, 40, 18, 12, Terrain.Industrial, 1);

  t.base(0, 18, 38, { air: true });
  t.base(1, 82, 38, { air: true });
  t.structure('shipyard', 0, 27, 46, { key: 'own-yard', facing: 0 });
  t.structure('shipyard', 1, 71, 48, { key: 'corps-yard', facing: Math.PI });
  t.structure('coastalBattery', 1, 70, 44, { key: 'corps-battery', facing: Math.PI / 2 });
  t.structure('coastalBattery', 1, 70, 30, { key: 'corps-battery-east', facing: Math.PI });
  t.structure('radarStation', 1, 60, 14, { key: 'isle-radar' });
  t.structure('supplyDepot', 1, 88, 26, { key: 'corps-depot' });

  t.force(0, [...NATO_ARMOUR, 'fighter'], 18, 30);
  t.navalForce(0, ['corvette', 'frigate'], 28, 40);
  t.force(1, [...CORPS_ARMOUR, 'fighter'], 82, 30);
  t.navalForce(1, ['corvette', 'frigate'], 72, 40);
  t.navalForce(1, ['missileBoat', 'missileBoat'], 64, 44);
  t.force(1, ['atgm', 'atgm'], 60, 20);

  t.ore(12, 50, 3, 820);
  t.ore(90, 50, 3, 820);
  t.ore(44, 22, 3, 700);

  const players: readonly [TheatrePlayerSpec, TheatrePlayerSpec] = [
    {
      name: 'UK Combined Task Force',
      factionId: 'uk',
      start: [18, 38],
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
    { name: 'Corps Coastal Command', factionId: 'russia', start: [82, 38], isAI: true },
  ];
  return t.build(
    {
      id: 'straits-final',
      name: 'Kestrel Straits — The Finale',
      description:
        'The full combined-arms theatre: two islands, a wide strait, two navy yards and a corps naval base.',
      targetSize: 'large',
    },
    players,
    { settings: { seed: 0xcf70, startingMats: 4000, startingReq: 200, fog: true } },
  );
}

/** Baltic theatre registry, in campaign order. */
export const BALTIC_THEATRES: Readonly<Record<string, () => Scenario>> = Object.freeze({
  'kestrel-beach': createKestrelBeach,
  'rust-pass': createRustPass,
  'strait-denial': createStraitDenial,
  'lapland-watch': createLaplandWatch,
  'foundry-relief': createFoundryRelief,
  'granite-steps': createGraniteSteps,
  'amber-coast': createAmberCoast,
  'signal-hill': createSignalHill,
  'convoy-lane': createConvoyLane,
  'rail-junction': createRailJunction,
  'corridor-break': createCorridorBreak,
  'straits-final': createStraitsFinal,
});
