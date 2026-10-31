/**
 * Networked battle view: the client mirror of the room's projection.
 *
 * The point of these tests is narrow and important — the battlefield must draw
 * exactly what the room sent, nothing more. A shell that silently kept local
 * state would show the opponent's real opening, and a mirror that dropped the
 * charted silhouettes would lose the fog-of-war memory the renderer relies on.
 */
import { Game } from '../src/sim/game';
import { builtinScenario } from '../src/data/scenarios';
import { cloneScenario, type Scenario } from '../src/sim/scenario';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import {
  NetworkBattle,
  approachAngle,
  wireCommand,
  type WireCommand,
} from '../src/multiplayer/networkBattle';
import { TILE_SIZE } from '../src/sim/constants';
import type { Command } from '../src/sim/types';

function scenario(): Scenario {
  return builtinScenario('rust-valley').create();
}

function authoritative(seed: Scenario): Game {
  return new Game(cloneScenario(seed), { localPlayerId: 0, enableAI: false });
}

/** A display shell exactly as the app builds it: no local world at all. */
function shell(seed: Scenario, team: number): Game {
  return new Game(cloneScenario(seed), { localPlayerId: team, enableAI: false, skipInit: true });
}

describe('networked battle — adopting the room view', () => {
  it('draws only the entities the projection sent, at the projected positions', () => {
    const map = scenario();
    const truth = authoritative(map);
    const snapshot = createTeamSnapshot(truth, 1);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });

    expect(view.state.entities).toHaveLength(0);
    battle.apply(snapshot);

    expect(view.state.entities.length).toBe(snapshot.entities.length);
    expect(new Set(view.state.entities.map((e) => e.id))).toEqual(
      new Set(snapshot.entities.map((e) => e.id)),
    );
    for (const projected of snapshot.entities) {
      const drawn = view.getEntity(projected.id);
      expect(drawn).toBeDefined();
      expect(drawn?.x).toBeCloseTo(projected.x, 5);
      expect(drawn?.z).toBeCloseTo(projected.z, 5);
      expect(drawn?.defId).toBe(projected.defId);
    }
    // Every drawn entity is friendly or genuinely visible: the snapshot is the
    // only source of truth, so the mirror cannot hold an unseen enemy.
    const visible = new Set(snapshot.entities.filter((e) => e.remembered !== true).map((e) => e.id));
    for (const entity of view.state.entities) {
      if (entity.owner === 1) continue;
      expect(visible.has(entity.id)).toBe(true);
    }
  });

  it('adopts the team fog, player economy and tick', () => {
    const map = scenario();
    const truth = authoritative(map);
    truth.state.players[1].mats = 4321;
    truth.state.players[1].req = 77;
    truth.state.tick = 900;
    const snapshot = createTeamSnapshot(truth, 1);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.apply(snapshot);

    expect(Array.from(view.state.fog[1])).toEqual(snapshot.fog);
    expect(view.player(1)?.mats).toBe(4321);
    expect(view.player(1)?.req).toBe(77);
    expect(view.state.tick).toBe(900);
    expect(battle.status().tick).toBe(900);
    expect(view.state.ready).toBe(true);
  });

  it('keeps charted structures as silhouettes outside the visible set', () => {
    const map = scenario();
    const truth = authoritative(map);
    const enemyBuilding = truth.state.entities.find((e) => e.kind === 'building' && e.owner === 0);
    expect(enemyBuilding).toBeDefined();
    // The enemy command post was seen earlier and has been out of vision since.
    truth.state.charted.push({ team: 1, entityId: enemyBuilding!.id });
    const snapshot = createTeamSnapshot(truth, 1);
    const remembered = snapshot.entities.find((e) => e.id === enemyBuilding!.id);
    expect(remembered?.remembered).toBe(true);
    expect(remembered?.hp).toBeNull();

    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.apply(snapshot);

    expect(view.visionStateOf(1, enemyBuilding!.id)).toBe('remembered');
    expect(view.isKnownTo(1, enemyBuilding!.id)).toBe(true);
    expect(view.isVisibleTo(1, enemyBuilding!.id)).toBe(false);
    // A silhouette carries no live integrity on screen either.
    expect(view.getEntity(enemyBuilding!.id)?.hp).toBeGreaterThan(0);
  });

  it('maps the room result to a seat-relative outcome', () => {
    const map = scenario();
    const truth = authoritative(map);
    const finished = createTeamSnapshot(truth, 1);
    finished.result = {
      phase: 'finished',
      winnerTeam: 1,
      reason: 'elimination',
      tick: 12_000,
      teams: [
        { team: 0, playerIds: [0], defeated: true, score: null },
        { team: 1, playerIds: [1], defeated: false, score: 100 },
      ],
    };
    const view = shell(map, 1);
    new NetworkBattle({ game: view, team: 1, send: () => true }).apply(finished);
    expect(view.state.victory).toBe('victory');

    const loser = shell(map, 1);
    new NetworkBattle({ game: loser, team: 1, send: () => true }).apply({
      ...finished,
      result: { ...finished.result, winnerTeam: 0 },
    });
    expect(loser.state.victory).toBe('defeat');

    const draw = shell(map, 1);
    new NetworkBattle({ game: draw, team: 1, send: () => true }).apply({
      ...finished,
      result: { ...finished.result, winnerTeam: null },
    });
    expect(draw.state.victory).toBe('draw');
  });

  it('ignores a snapshot addressed to the other seat', () => {
    const map = scenario();
    const truth = authoritative(map);
    const snapshot = createTeamSnapshot(truth, 0);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.apply(snapshot);
    expect(view.state.entities).toHaveLength(0);
    expect(battle.status().updates).toBe(0);
  });
});

describe('networked battle — motion between updates', () => {
  it('eases toward a new position instead of teleporting', () => {
    const map = scenario();
    const truth = authoritative(map);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.apply(createTeamSnapshot(truth, 1));

    const unit = truth.state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
    const startX = view.getEntity(unit.id)!.x;
    const moved = createTeamSnapshot(truth, 1);
    const row = moved.entities.find((e) => e.id === unit.id)!;
    row.x = startX + TILE_SIZE;
    battle.apply(moved);

    // The target is a tile away; one short frame must not arrive there.
    battle.sync(1 / 60);
    const afterOne = view.getEntity(unit.id)!.x;
    expect(afterOne).toBeGreaterThan(startX);
    expect(afterOne).toBeLessThan(startX + TILE_SIZE);

    for (let i = 0; i < 120; i++) battle.sync(1 / 60);
    expect(view.getEntity(unit.id)!.x).toBeCloseTo(startX + TILE_SIZE, 2);
  });

  it('snaps a jump it cannot have walked, so a resync never slides a hull', () => {
    const map = scenario();
    const truth = authoritative(map);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.apply(createTeamSnapshot(truth, 1));

    const unit = truth.state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
    const moved = createTeamSnapshot(truth, 1);
    const row = moved.entities.find((e) => e.id === unit.id)!;
    row.x += TILE_SIZE * 20;
    battle.apply(moved);
    battle.sync(1 / 60);
    expect(view.getEntity(unit.id)!.x).toBeCloseTo(row.x, 5);
  });

  it('turns the short way around', () => {
    expect(approachAngle(0.1, -0.1 + Math.PI * 2, 0.5)).toBeCloseTo(0.1 - 0.1, 3);
    expect(approachAngle(0, Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('networked battle — orders', () => {
  const command = (): Command => ({ type: 'move', team: 1, ids: [1], x: 100, z: 100 });

  it('sends the order upstream and counts it', () => {
    const map = scenario();
    const truth = authoritative(map);
    const view = shell(map, 1);
    const sent: WireCommand[] = [];
    const battle = new NetworkBattle({
      game: view,
      team: 1,
      send: (order) => {
        sent.push(order);
        return true;
      },
    });
    battle.apply(createTeamSnapshot(truth, 1));

    expect(battle.send(command())).toBe(true);
    expect(sent).toHaveLength(1);
    // Intent only, and no authority: the room derives the team from the seat, so
    // a command that named its own team would be refused as a forged field.
    expect(sent[0]).toEqual({ type: 'move', ids: [1], x: 100, z: 100 });
    expect(sent[0]).not.toHaveProperty('team');
    expect(battle.status().commandsSent).toBe(1);
    // Intent only: the shell's own queue never sees a networked order.
    expect(view.pending).toHaveLength(0);
  });

  it('strips every field that could claim authority from an order', () => {
    const wire = wireCommand({
      type: 'attack',
      team: 2,
      playerId: 9,
      owner: 7,
      seat: 1,
      ids: [3],
      targetId: 12,
    } as unknown as Command);
    expect(wire).toEqual({ type: 'attack', ids: [3], targetId: 12 });
  });

  it('stops sending once the match is decided', () => {
    const map = scenario();
    const truth = authoritative(map);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    const snapshot = createTeamSnapshot(truth, 1);
    snapshot.result = { ...snapshot.result, phase: 'finished', winnerTeam: 0 };
    battle.apply(snapshot);
    expect(battle.send(command())).toBe(false);
    expect(battle.status().commandsSent).toBe(0);
  });

  it('reports a transport that could not send', () => {
    const map = scenario();
    const truth = authoritative(map);
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => false });
    battle.apply(createTeamSnapshot(truth, 1));
    expect(battle.send(command())).toBe(false);
    expect(battle.status().commandsSent).toBe(0);
  });

  it('counts room refusals separately from sent orders', () => {
    const map = scenario();
    const view = shell(map, 1);
    const battle = new NetworkBattle({ game: view, team: 1, send: () => true });
    battle.noteCommandRejection();
    expect(battle.commandRejections).toBe(1);
  });
});
