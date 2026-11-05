import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_SCENARIO_IDS,
  COMPETITIVE_SCENARIO_IDS,
  DEFAULT_MULTIPLAYER_SCENARIO_ID,
  SCENARIOS,
  defaultScenarioId,
  duelStartSlots,
  isScenarioAvailable,
  scenarioById,
  scenarioSlots,
  scenarioSummary,
  scenariosForMode,
  teamStartSlots,
} from '../src/data/scenarioCatalog';
import { auditCompetitiveMap, auditCompetitiveRoster } from '../src/data/mapValidation';
import { rotatePoint } from '../src/data/competitiveMaps';
import { Game } from '../src/sim/game';
import {
  canLaunch,
  parseScenario,
  scenarioToJson,
  validateScenario,
  cloneScenario,
  type Scenario,
} from '../src/sim/scenario';
import { TERRAIN, Terrain, tileIndex, type TerrainId } from '../src/sim/terrain';
import {
  buildLobbyScenario,
  defaultLobbyConfig,
  isPlayableMapId,
  validateLobbyConfig,
} from '../src/multiplayer/lobbyConfig';
import { BUILDINGS } from '../src/data/buildings';
import { HARVESTER_CAPACITY } from '../src/sim/constants';
import { RoomLobby } from '../src/multiplayer/roomLobby';
import { CAMPAIGNS } from '../src/data/campaign';
import { readFileSync } from 'node:fs';

const COMPETITIVE = SCENARIOS.filter((entry) => entry.modes.includes('multiplayer'));


describe('scenario catalogue', () => {
  it('lists every battlefield once, with stable unique ids', () => {
    const ids = SCENARIOS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    // One bespoke theatre per campaign operation (12 + 12) plus the
    // competitive pool of seventeen.
    expect(ids.length).toBe(45);
    // Four original campaign theatres, 24 operation theatres, 17 competitive.
    expect(CAMPAIGN_SCENARIO_IDS.length).toBe(4);
    expect(COMPETITIVE_SCENARIO_IDS.length).toBe(17);
    expect(ids.length - CAMPAIGN_SCENARIO_IDS.length - COMPETITIVE_SCENARIO_IDS.length).toBe(24);
  });

  it('reserves the four original theatres for the campaign', () => {
    for (const id of CAMPAIGN_SCENARIO_IDS) {
      const entry = scenarioById(id)!;
      expect(entry.modes).toEqual(['campaign']);
      expect(isScenarioAvailable(id, 'campaign')).toBe(true);
      expect(isScenarioAvailable(id, 'skirmish')).toBe(false);
      expect(isScenarioAvailable(id, 'multiplayer')).toBe(false);
    }
    expect(scenariosForMode('skirmish').map((entry) => entry.id)).not.toContain('island-assault');
  });

  it('offers all eight competitive maps to skirmish and multiplayer only', () => {
    const skirmish = scenariosForMode('skirmish').map((entry) => entry.id);
    const multiplayer = scenariosForMode('multiplayer').map((entry) => entry.id);
    expect(skirmish).toEqual(COMPETITIVE_SCENARIO_IDS);
    expect(multiplayer).toEqual(COMPETITIVE_SCENARIO_IDS);
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      expect(isScenarioAvailable(id, 'skirmish')).toBe(true);
      expect(isScenarioAvailable(id, 'multiplayer')).toBe(true);
      expect(isScenarioAvailable(id, 'campaign')).toBe(false);
    }
  });

  it('answers availability strictly, including for junk ids', () => {
    expect(isScenarioAvailable(undefined, 'skirmish')).toBe(false);
    expect(isScenarioAvailable(42, 'multiplayer')).toBe(false);
    expect(isScenarioAvailable('no-such-map', 'multiplayer')).toBe(false);
    expect(isScenarioAvailable('ISLAND-ASSAULT', 'skirmish')).toBe(false);
    expect(defaultScenarioId('multiplayer')).toBe(DEFAULT_MULTIPLAYER_SCENARIO_ID);
    expect(isPlayableMapId(defaultScenarioId('multiplayer'))).toBe(true);
  });

  it('describes a map without generating its tiles', () => {
    const entry = scenarioById('drylands')!;
    const summary = scenarioSummary(entry);
    expect(summary.size).toBe('112×112');
    expect(summary.slots).toBe(4);
    expect(summary.playerCounts).toEqual([2, 4]);
    expect(summary.tags.length).toBeGreaterThan(1);
  });

  it('gives each competitive map its own strategic identity and footprint', () => {
    const names = new Set(COMPETITIVE.map((entry) => entry.name));
    const focus = new Set(COMPETITIVE.map((entry) => entry.focus));
    const sizes = new Set(COMPETITIVE.map((entry) => `${entry.width}x${entry.height}`));
    expect(names.size).toBe(17);
    expect(focus.size).toBe(17);
    expect(sizes.size).toBe(17);
  });

  it('keeps the campaign references pointing at real theatres', () => {
    for (const id of CAMPAIGN_SCENARIO_IDS) {
      expect(scenarioById(id)?.create).toBeTypeOf('function');
    }
  });

  it('never leaves material inside a structure footprint', () => {
    // A deposit a building stands on can never be mined: the hauler drives to
    // the nearest ground it can occupy, never comes inside mining reach, and
    // waits there. Ore and structures are authored separately on every map, so
    // the assembled scenario must be clear of them before any match starts.
    for (const entry of COMPETITIVE) {
      const scenario = entry.create();
      const buried: string[] = [];
      for (const structure of scenario.structures) {
        const footprint = BUILDINGS[structure.defId]?.footprint;
        if (!footprint) continue;
        for (let dz = 0; dz < footprint.h; dz++) {
          for (let dx = 0; dx < footprint.w; dx++) {
            const x = structure.x + dx;
            const z = structure.z + dz;
            const i = tileIndex(scenario.width, x, z);
            if (scenario.tiles[i]?.o > 0) buried.push(`${structure.defId}@${x},${z}`);
          }
        }
      }
      expect(buried, entry.id).toEqual([]);
    }
  });
});

describe('declared start slots', () => {
  it('derives four rotated slots from the authored first slot', () => {
    for (const entry of COMPETITIVE) {
      const slots = scenarioSlots(entry);
      expect(slots, entry.id).toHaveLength(4);
      slots.forEach((slot, k) => {
        const want = rotatePoint(entry.width, k as 0 | 1 | 2 | 3, entry.start![0], entry.start![1]);
        expect(slot, `${entry.id} slot ${k}`).toEqual(want);
      });
    }
  });

  it('pairs opposite slots for 1v1 and adjacent pairs for 2v2', () => {
    for (const entry of COMPETITIVE) {
      const duel = duelStartSlots(entry)!;
      expect(Math.hypot(duel[0].x - duel[1].x, duel[0].z - duel[1].z)).toBeGreaterThan(entry.width * 0.5);
      const teams = teamStartSlots(entry)!;
      expect(teams.team0).toHaveLength(2);
      expect(teams.team1).toHaveLength(2);
      // Teammates are adjacent in rotation order, not opposite.
      expect(Math.hypot(teams.team0[0].x - teams.team0[1].x, teams.team0[0].z - teams.team0[1].z)).toBeLessThan(
        Math.hypot(teams.team0[0].x - teams.team1[0].x, teams.team0[0].z - teams.team1[0].z),
      );
    }
  });

  it('seats the players on opposite slots and nothing else', () => {
    for (const entry of COMPETITIVE) {
      const scenario = entry.create();
      const slots = scenario.slots!;
      expect(scenario.players).toHaveLength(2);
      expect({ x: scenario.players[0].startX, z: scenario.players[0].startZ }).toEqual(slots[0]);
      expect({ x: scenario.players[1].startX, z: scenario.players[1].startZ }).toEqual(slots[2]);
    }
  });
});

describe('four-way symmetry', () => {
  it('passes every structural, symmetry and access audit', () => {
    for (const report of auditCompetitiveRoster()) {
      expect(report.problems, report.diagnostics.id).toEqual([]);
    }
  });

  it('detects a feature painted into one quadrant only', () => {
    const entry = scenarioById('open-front')!;
    const broken = entry.create();
    // One teleport-free change: a single rock tile in the first quadrant only.
    broken.tiles[tileIndex(broken.width, 21, 21)].t = Terrain.Rock;
    const report = auditCompetitiveMap(entry, broken);
    expect(report.problems.some((problem) => problem.code === 'asymmetric-terrain')).toBe(true);
  });

  it('detects a moved objective and a moved deposit', () => {
    const entry = scenarioById('contact-zone')!;
    const shifted = entry.create();
    const relay = shifted.structures.find((s) => s.defId === 'relay' && s.owner === -1)!;
    relay.x += 2;
    expect(auditCompetitiveMap(entry, shifted).problems.some((p) => p.code === 'asymmetric-objective')).toBe(true);

    const oreMoved = entry.create();
    let firstOre = -1;
    for (let i = 0; i < oreMoved.tiles.length; i++) {
      if (oreMoved.tiles[i].o > 0) {
        firstOre = i;
        break;
      }
    }
    oreMoved.tiles[firstOre].o = 0;
    expect(auditCompetitiveMap(entry, oreMoved).problems.some((p) => p.code === 'asymmetric-terrain')).toBe(true);
  });

  it('detects an unequal starting force', () => {
    const entry = scenarioById('open-front')!;
    const broken = entry.create();
    broken.units.pop();
    const report = auditCompetitiveMap(entry, broken);
    expect(report.problems.some((p) => p.code === 'asymmetric-force' || p.code === 'force-mismatch')).toBe(true);
  });
});

describe.each(COMPETITIVE.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
  const scenario = entry.create();

  it('is a valid, launchable scenario', () => {
    const errors = validateScenario(scenario).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
    expect(canLaunch(scenario)).toBe(true);
  });

  it('is square, four-way ground with four buildable starts', () => {
    expect(scenario.width).toBe(scenario.height);
    expect(scenario.slots).toHaveLength(4);
    for (const slot of scenario.slots!) {
      const tile = scenario.tiles[tileIndex(scenario.width, slot.x, slot.z)];
      expect(TERRAIN[tile.t as TerrainId].water).toBe(false);
      expect(TERRAIN[tile.t as TerrainId].buildable).toBe(true);
    }
  });

  it('gives both seats a base, a landing force and ore within reach', () => {
    for (const owner of [0, 1]) {
      expect(scenario.structures.some((s) => s.owner === owner && s.defId === 'commandPost')).toBe(true);
      expect(scenario.units.filter((u) => u.owner === owner).length).toBeGreaterThanOrEqual(8);
    }
    let ore = 0;
    for (const tile of scenario.tiles) if (tile.o > 0) ore++;
    expect(ore).toBeGreaterThan(80);
  });

  it('keeps every starting unit off the structures', () => {
    const occupied = new Set<string>();
    for (const s of scenario.structures) {
      const def = BUILDINGS[s.defId];
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) occupied.add(`${s.x + dx},${s.z + dz}`);
      }
    }
    for (const unit of scenario.units) {
      expect(occupied.has(`${unit.x},${unit.z}`), `${unit.defId}@${unit.x},${unit.z}`).toBe(false);
    }
  });

  it('regenerates identically and survives a scenario round trip', () => {
    const again = entry.create();
    expect(scenarioToJson(again)).toBe(scenarioToJson(scenario));
    const parsed = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(parsed.slots).toEqual(scenario.slots);
    expect(scenarioToJson(parsed)).toBe(scenarioToJson(scenario));
  });

  it('runs a live simulation on the map', () => {
    const game = new Game(cloneScenario(scenario), { enableAI: false });
    for (let i = 0; i < 120; i++) game.tick();
    expect(game.state.tick).toBe(120);
    expect(game.state.entities.length).toBeGreaterThan(8);
    expect(game.state.victory).toBe('playing');
  });

  it('levels the foundations under both command posts', () => {
    for (const owner of [0, 1]) {
      const post = scenario.structures.find((s) => s.owner === owner && s.defId === 'commandPost')!;
      const def = BUILDINGS.commandPost;
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          const tile = scenario.tiles[tileIndex(scenario.width, post.x + dx, post.z + dz)];
          expect([Terrain.DeepWater, Terrain.ShallowWater, Terrain.Forest, Terrain.Rock]).not.toContain(tile.t);
        }
      }
    }
  });
});

describe('competitive economy', () => {
  it('fields a forward supply depot on every battlefield', () => {
    // Deposits run dry in a long match; the depot is the secondary income that
    // keeps a side fighting instead of sitting on a one-per-second lifeline.
    for (const entry of scenariosForMode('skirmish')) {
      const scenario = entry.create();
      const depots = scenario.structures.filter(
        (s) => s.defId === 'supplyDepot' && s.owner === -1,
      );
      // One per rotation, so no seat is nearer a depot than another.
      expect(depots.length, entry.id).toBeGreaterThanOrEqual(4);
      expect(new Set(depots.map((d) => `${d.x},${d.z}`)).size, entry.id).toBe(depots.length);
    }
  });

  it('leaves no authored deposit thinner than a full hopper', () => {
    for (const entry of scenariosForMode('skirmish')) {
      const scenario = entry.create();
      let thinnest = Infinity;
      for (const tile of scenario.tiles) if (tile.o > 0) thinnest = Math.min(thinnest, tile.o);
      expect(Number.isFinite(thinnest), entry.id).toBe(true);
      expect(thinnest, entry.id).toBeGreaterThanOrEqual(HARVESTER_CAPACITY);
    }
  });
});

describe('competitive diagnostics', () => {
  it('reports measurements instead of claiming balance', () => {
    const report = auditCompetitiveMap(scenarioById('open-front')!);
    const d = report.diagnostics;
    expect(d.startToCentre).toHaveLength(4);
    expect(new Set(d.startToCentre).size).toBe(1);
    expect(new Set(d.orePerSlot).size).toBe(1);
    expect(new Set(d.sitesPerSlot).size).toBe(1);
    expect(d.reachByClass.foot).toBeGreaterThan(0);
    expect(d.reachByClass.tracked).toBeGreaterThan(0);
    expect(d.reachByClass.wheeled).toBeGreaterThan(0);
  });

  it('measures class-aware route cost to the centre from every slot', () => {
    for (const report of auditCompetitiveRoster()) {
      const { travelCost, id } = report.diagnostics;
      for (const cls of ['foot', 'wheeled', 'tracked'] as const) {
        expect(travelCost[cls], `${id} ${cls}`).toHaveLength(4);
        for (const cost of travelCost[cls]) {
          expect(Number.isFinite(cost), `${id} ${cls}`).toBe(true);
          expect(cost).toBeGreaterThan(0);
        }
        // Four-way symmetry: every slot pays the same to reach the middle.
        expect(new Set(travelCost[cls]).size, `${id} ${cls}`).toBe(1);
      }
    }
    // The measure follows the ground: broken country costs tracks more than
    // boots, and the compact map is genuinely crossed faster than the large one.
    const woodland = auditCompetitiveMap(scenarioById('woodland-divide')!);
    expect(woodland.diagnostics.travelCost.tracked[0]).toBeGreaterThan(
      woodland.diagnostics.travelCost.foot[0],
    );
    const contact = auditCompetitiveMap(scenarioById('contact-zone')!);
    const drylands = auditCompetitiveMap(scenarioById('drylands')!);
    expect(contact.diagnostics.travelCost.foot[0]).toBeLessThan(
      drylands.diagnostics.travelCost.foot[0] * 0.5,
    );
  });

  it('shows the roster really differs in terrain and open ground', () => {
    const reports = auditCompetitiveRoster();
    const forest = reports.map((r) => r.diagnostics.terrain.forest);
    const urban = reports.map((r) => r.diagnostics.terrain.urban);
    const water = reports.map((r) => r.diagnostics.terrain.water);
    expect(Math.max(...forest) - Math.min(...forest)).toBeGreaterThan(400);
    expect(Math.max(...urban) - Math.min(...urban)).toBeGreaterThan(200);
    expect(Math.max(...water)).toBeGreaterThan(1000);
    // Open Front is the roomiest map for vehicles relative to its size.
    const openFront = reports.find((r) => r.diagnostics.id === 'open-front')!;
    expect(openFront.diagnostics.areaByClass.tracked).toBeGreaterThan(6000);
  });
});

describe('multiplayer scenario selection', () => {
  it('rejects campaign-only maps, unknown ids and malformed ids', () => {
    const base = defaultLobbyConfig();
    for (const mapId of ['island-assault', 'rust-valley', 'kestrel-straits', 'foundry-district']) {
      const parsed = validateLobbyConfig({ ...base, mapId });
      expect(parsed.ok, mapId).toBe(false);
      if (!parsed.ok) expect(parsed.problem.code).toBe('invalid-map');
    }
    for (const mapId of ['no-such-map', '', '../etc/passwd', 42, null, undefined]) {
      const parsed = validateLobbyConfig({ ...base, mapId });
      expect(parsed.ok, String(mapId)).toBe(false);
    }
  });

  it('accepts every competitive map and builds the authoritative scenario for it', () => {
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      const config = defaultLobbyConfig(id, 600_000);
      expect(config.mapId).toBe(id);
      const parsed = validateLobbyConfig(config);
      expect(parsed.ok, id).toBe(true);
      const scenario = buildLobbyScenario(config);
      expect(scenario.meta.id, id).toBe(id);
      expect(scenario.settings.timeLimitSec).toBe(600);
      expect(scenario.players[0].isAI).toBe(false);
      expect(scenario.players[1].isAI).toBe(false);
    }
  });

  it('gives both seats the same deterministic scenario', () => {
    const config = defaultLobbyConfig('crossing-point', 600_000);
    const a = buildLobbyScenario(config);
    const b = buildLobbyScenario({ ...config, seats: config.seats.map((seat) => ({ ...seat })) });
    expect(scenarioToJson(a)).toBe(scenarioToJson(b));
  });

  it('refuses to build a match from a non-multiplayer map even if called directly', () => {
    const base = defaultLobbyConfig();
    expect(() => buildLobbyScenario({ ...base, mapId: 'island-assault' })).toThrow(/not available for multiplayer/);
  });

  it('stamps each seat nation and colour without touching the map layout', () => {
    const config = defaultLobbyConfig('drylands', 600_000);
    config.seats[0].nation = 'poland';
    config.seats[1].nation = 'belarus';
    config.seats[0].color = '#3f8fd2';
    config.seats[1].color = '#c8503f';
    const scenario: Scenario = buildLobbyScenario(config);
    expect(scenario.players[0].factionId).toBe('poland');
    expect(scenario.players[1].factionId).toBe('belarus');
    expect(scenario.players[0].color).toBe('#3f8fd2');
    const pristine = scenarioById('drylands')!.create();
    expect(scenario.tiles.length).toBe(pristine.tiles.length);
    expect(scenario.structures.map((s) => `${s.defId}:${s.x}:${s.z}`)).toEqual(
      pristine.structures.map((s) => `${s.defId}:${s.x}:${s.z}`),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Host map selection on the wire                                      */
/* ------------------------------------------------------------------ */

class MapSocket {
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* no-op */
  }
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
  last(): Record<string, unknown> {
    return this.messages()[this.messages().length - 1] ?? {};
  }
}

function mapLobby(): RoomLobby {
  return new RoomLobby({
    roomId: 'map-select',
    seats: [
      { seatId: 0, playerId: 0, team: 0, token: 'host-token-map-select' },
      { seatId: 1, playerId: 1, team: 1, token: 'guest-token-map-select' },
    ],
    config: defaultLobbyConfig('open-front', 600_000),
    hardDeadlineAt: Date.now() + 900_000,
    now: 1_000,
  });
}

describe('host battlefield selection', () => {
  it('lets the host switch to another competitive map and clears both ready states', () => {
    const lobby = mapLobby();
    const host = new MapSocket();
    const guest = new MapSocket();
    lobby.connect(0, 'host-token-map-select', host, 1_000);
    lobby.connect(1, 'guest-token-map-select', guest, 1_000);
    lobby.setReady(0, true);
    lobby.setReady(1, true);

    expect(lobby.setMapId(0, 'crossing-point')).toEqual({ ok: true });
    expect(lobby.lobbyConfig.mapId).toBe('crossing-point');
    expect(lobby.lobbyConfig.seats.map((seat) => seat.ready)).toEqual([false, false]);
    const state = guest.last();
    expect((state.config as Record<string, unknown>).mapId).toBe('crossing-point');
  });

  it('refuses the guest, and refuses maps the multiplayer catalogue does not admit', () => {
    const lobby = mapLobby();
    const guest = new MapSocket();
    lobby.connect(1, 'guest-token-map-select', guest, 1_000);
    expect(lobby.setMapId(1, 'drylands')).toMatchObject({ ok: false, code: 'host-only' });
    expect(lobby.setMapId(0, 'island-assault')).toMatchObject({ ok: false, code: 'invalid-map' });
    expect(lobby.setMapId(0, 'no-such-map')).toMatchObject({ ok: false, code: 'invalid-map' });
    expect(lobby.lobbyConfig.mapId).toBe('open-front');
  });

  it('routes a socket map request through the host-only rule and reports the room error', () => {
    const lobby = mapLobby();
    const host = new MapSocket();
    const guest = new MapSocket();
    lobby.connect(0, 'host-token-map-select', host, 1_000);
    lobby.connect(1, 'guest-token-map-select', guest, 1_000);

    guest.sent.length = 0;
    lobby.receive(
      1,
      guest,
      JSON.stringify({ type: 'lobbySet', v: 2, mapId: 'ironworks' }),
      2_000,
    );
    expect(guest.last()).toMatchObject({ type: 'error', code: 'host-only' });

    host.sent.length = 0;
    lobby.receive(0, host, JSON.stringify({ type: 'lobbySet', v: 2, mapId: 'ironworks' }), 2_000);
    expect(lobby.lobbyConfig.mapId).toBe('ironworks');
    expect((host.last().config as Record<string, unknown>).mapId).toBe('ironworks');
  });

  it('broadcasts the chosen start hour to both seats and builds it into the match', () => {
    const lobby = mapLobby();
    const host = new MapSocket();
    const guest = new MapSocket();
    lobby.connect(0, 'host-token-map-select', host, 1_000);
    lobby.connect(1, 'guest-token-map-select', guest, 1_000);

    expect(lobby.setStartHour(0, 22)).toEqual({ ok: true });
    // The guest fights on the same clock, so it must be told the hour; before
    // this the room kept it to itself and the guest display never updated.
    expect((guest.last().config as Record<string, unknown>).startHour).toBe(22);
    expect((host.last().config as Record<string, unknown>).startHour).toBe(22);

    expect(lobby.setStartHour(1, 6)).toMatchObject({ ok: false, code: 'host-only' });
    expect(lobby.setStartHour(0, 24)).toMatchObject({ ok: false, code: 'invalid-time' });
    expect(buildLobbyScenario(lobby.lobbyConfig).settings.startHour).toBe(22);
  });

  it('leaves the map\'s authored weather in the built match', () => {
    const lobby = mapLobby();
    const scenario = buildLobbyScenario(lobby.lobbyConfig);
    expect(scenario.settings.weather).toBe(scenarioById('open-front')!.create().settings.weather);
  });

  it('broadcasts the host weather choice and builds it into the match', () => {
    const lobby = mapLobby();
    const host = new MapSocket();
    const guest = new MapSocket();
    lobby.connect(0, 'host-token-map-select', host, 1_000);
    lobby.connect(1, 'guest-token-map-select', guest, 1_000);
    lobby.setReady(0, true);
    lobby.setReady(1, true);

    expect(lobby.setWeather(0, 'storm')).toEqual({ ok: true });
    // Weather changes what both players can see and how far they can shoot, so
    // it is shared state, and it resets the readiness both seats had given.
    expect((guest.last().config as Record<string, unknown>).weather).toBe('storm');
    expect((host.last().config as Record<string, unknown>).weather).toBe('storm');
    expect(lobby.lobbyConfig.seats.map((seat) => seat.ready)).toEqual([false, false]);

    expect(lobby.setWeather(1, 'snow')).toMatchObject({ ok: false, code: 'host-only' });
    expect(lobby.setWeather(0, 'hail')).toMatchObject({ ok: false, code: 'invalid-weather' });
    expect(buildLobbyScenario(lobby.lobbyConfig).settings.weather).toBe('storm');
  });

  it('rejects an unknown weather profile and adopts the authored sky when absent', () => {
    const config = defaultLobbyConfig('open-front', 600_000);
    expect(validateLobbyConfig({ ...config, weather: 'blizzard' }).ok).toBe(true);
    expect(validateLobbyConfig({ ...config, weather: 'hail' })).toMatchObject({ ok: false });
    // A lobby persisted before weather was selectable keeps working: it adopts
    // the map's authored profile rather than failing to restore.
    const legacy: Record<string, unknown> = { ...config };
    delete legacy.weather;
    const parsed = validateLobbyConfig(legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.weather).toBe(
        scenarioById('open-front')!.create().settings.weather,
      );
    }
  });

  it('rejects a malformed map field instead of accepting an object', () => {
    const lobby = mapLobby();
    const host = new MapSocket();
    lobby.connect(0, 'host-token-map-select', host, 1_000);
    host.sent.length = 0;
    lobby.receive(0, host, JSON.stringify({ type: 'lobbySet', v: 2, mapId: { evil: true } }), 2_000);
    expect(host.last()).toMatchObject({ type: 'error', code: 'malformed-message' });
    expect(lobby.lobbyConfig.mapId).toBe('open-front');
  });
});

/* ------------------------------------------------------------------ */
/* Campaign separation and UI wiring                                   */
/* ------------------------------------------------------------------ */

describe('campaign theatres', () => {
  it('still loads and validates every original map, unchanged in format', () => {
    for (const id of CAMPAIGN_SCENARIO_IDS) {
      const scenario = scenarioById(id)!.create();
      const errors = validateScenario(scenario).filter((issue) => issue.severity === 'error');
      expect(errors, id).toEqual([]);
      expect(canLaunch(scenario), id).toBe(true);
      // Campaign maps keep their two authored starts and declare no four-way slots.
      expect(scenario.players).toHaveLength(2);
      expect(scenario.slots).toBeUndefined();
    }
  });

  it('is what the campaign missions deploy on', () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        expect(isScenarioAvailable(mission.mapId, 'campaign'), mission.id).toBe(true);
      }
    }
  });
});

describe('map selection wiring', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/ui/multiplayerPanel.ts', import.meta.url), 'utf8');

  it('builds the skirmish selector from the catalogue, not a local list', () => {
    expect(app).toContain("scenariosForMode('skirmish')");
    expect(app).not.toMatch(/BUILTIN_SCENARIOS/);
    expect(app).toContain("text('brief-tags'");
  });

  it('offers only multiplayer maps in the lobby and sends a host map intent', () => {
    expect(panel).toContain("scenariosForMode('multiplayer')");
    expect(panel).toContain('client.setMap(');
    expect(panel).not.toMatch(/BUILTIN_SCENARIOS/);
  });

  it('offers weather in the lobby and sends a host weather intent', () => {
    expect(panel).toContain('client.setWeather(');
    expect(panel).toContain('id="mp-weather"');
    expect(panel).toContain('WEATHER_KINDS.map');
  });
});
