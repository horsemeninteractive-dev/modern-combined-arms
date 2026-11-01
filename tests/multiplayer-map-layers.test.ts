import { describe, expect, it } from 'vitest';
import { COMPETITIVE_SCENARIO_IDS, scenarioById } from '../src/data/scenarioCatalog';
import { Game } from '../src/sim/game';
import type { Scenario } from '../src/sim/scenario';
import { Overlay, packOverlay } from '../src/sim/terrain';
import { createTeamSnapshot, projectMap } from '../src/multiplayer/projection';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { syncMessage } from './phase2a4-helpers';

/**
 * The room's map, not the client's own copy of it, is the battlefield both seats
 * paint. These tests pin the surface layer to that map so a networked client
 * renders the same crops, reeds and hedgerows the server is simulating.
 */

const ROOM = 'map-layers-room';

/** A real competitive battlefield with a known layer stamped into two tiles. */
function layeredScenario(): Scenario {
  const scenario = scenarioById(COMPETITIVE_SCENARIO_IDS[0])!.create();
  scenario.settings.seed = 424242;
  scenario.settings.fog = true;
  scenario.tiles[0].v = packOverlay(Overlay.Crop, 2);
  scenario.tiles[scenario.width * 2 + 3].v = packOverlay(Overlay.Reeds, 3);
  return scenario;
}

function room(map: Scenario = layeredScenario()): Game {
  return new Game(map, { localPlayerId: -1, enableAI: false });
}

/** A display shell, exactly as the app builds one before the first sync. */
function clientView(map: Scenario): Game {
  return new Game(map, { localPlayerId: 0, enableAI: false, skipInit: true });
}

function assembler(): SnapshotAssembler {
  return new SnapshotAssembler({ roomId: ROOM, team: 0 });
}

describe('multiplayer map projection: surface layer', () => {
  it('ships the packed surface layer with the immutable map', () => {
    const scenario = layeredScenario();
    const projected = projectMap(room(scenario));
    expect(projected.overlay).toHaveLength(projected.terrain.length);
    expect(projected.overlay?.[0]).toBe(packOverlay(Overlay.Crop, 2));
    expect(projected.overlay?.[scenario.width * 2 + 3]).toBe(packOverlay(Overlay.Reeds, 3));
    // Nothing in the layer leaves the byte the renderer and the editor use.
    for (const value of projected.overlay ?? []) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(31);
    }
  });

  it('accepts the layer in a sync and keeps it on the reconstructed map', () => {
    const game = room();
    const snapshot = createTeamSnapshot(game, 0, game.state.eventSeq);
    const result = assembler().apply(syncMessage(snapshot, { roomId: ROOM }));
    expect(result).toMatchObject({ ok: true, kind: 'sync' });
  });

  it('keeps the reconstructed layer equal to the projected one', () => {
    const game = room();
    const client = assembler();
    client.apply(syncMessage(createTeamSnapshot(game, 0, game.state.eventSeq), { roomId: ROOM }));
    expect(client.state()?.map.overlay).toEqual(projectMap(game).overlay);
  });

  it('still accepts a sync from a build that predates the layer', () => {
    const game = room();
    const snapshot = createTeamSnapshot(game, 0, game.state.eventSeq);
    const map = { ...snapshot.map };
    delete map.overlay;
    const client = assembler();
    expect(client.apply(syncMessage({ ...snapshot, map }, { roomId: ROOM }))).toMatchObject({
      ok: true,
    });
    expect(client.state()?.map.overlay).toBeUndefined();
  });

  it('rejects a layer of the wrong length or an out-of-range byte', () => {
    const game = room();
    const snapshot = createTeamSnapshot(game, 0, game.state.eventSeq);
    const short = { ...snapshot.map, overlay: [packOverlay(Overlay.Crop, 1)] };
    const tooBig = { ...snapshot.map, overlay: snapshot.map.overlay!.map(() => 200) };
    expect(assembler().apply(syncMessage({ ...snapshot, map: short }, { roomId: ROOM }))).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(assembler().apply(syncMessage({ ...snapshot, map: tooBig }, { roomId: ROOM }))).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('multiplayer map adoption: client rendering', () => {
  it('adopts the room layers into the display map and its authored tiles', () => {
    const roomGame = room();
    const display = clientView(layeredScenario());
    // The shell starts from a bare copy of the same battlefield.
    display.state.map.overlay?.fill(0);
    for (const tile of display.state.scenario.tiles) delete tile.v;

    expect(display.adoptNetworkMap(projectMap(roomGame))).toBe(true);
    const crop = packOverlay(Overlay.Crop, 2);
    expect(display.state.map.overlay?.[0]).toBe(crop);
    expect(display.state.scenario.tiles[0].v).toBe(crop);
    expect(display.state.map.terrain).toEqual(roomGame.state.map.terrain);
  });

  it('reports no change when the same map arrives again on a resync', () => {
    const roomGame = room();
    const display = clientView(layeredScenario());
    display.state.map.overlay?.fill(0);
    for (const tile of display.state.scenario.tiles) delete tile.v;
    expect(display.adoptNetworkMap(projectMap(roomGame))).toBe(true);
    expect(display.adoptNetworkMap(projectMap(roomGame))).toBe(false);
  });

  it('adopts remaining material without asking for a terrain rebuild', () => {
    const roomGame = room();
    const display = clientView(layeredScenario());
    const projected = projectMap(roomGame);
    projected.ore = projected.ore.map((value) => Math.max(0, value - 5));
    expect(display.adoptNetworkMap(projected)).toBe(false);
    expect(Array.from(display.state.map.ore)).toEqual(projected.ore);
  });

  it('refuses a map for a different battlefield instead of half-applying it', () => {
    const roomGame = room();
    const display = clientView(layeredScenario());
    const projected = projectMap(roomGame);
    expect(display.adoptNetworkMap({ ...projected, width: projected.width + 1 })).toBe(false);
    expect(display.adoptNetworkMap({ ...projected, overlay: [1, 2, 3] })).toBe(false);
    expect(display.state.map.overlay?.[0]).toBe(packOverlay(Overlay.Crop, 2));
  });
});
