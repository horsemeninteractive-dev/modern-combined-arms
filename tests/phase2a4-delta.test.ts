import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../src/sim/constants';
import type { Game } from '../src/sim/game';
import type { NeutralMatchResult } from '../src/multiplayer/matchResult';
import {
  createTeamSnapshot,
  createTeamState,
  projectMap,
} from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import type { DeltaChanges, SyncMessage } from '../src/multiplayer/protocol';
import {
  applyOk,
  canonicalState,
  deltaMessage,
  newAssembler,
  syncMessage,
} from './phase2a4-helpers';
import { hiddenEnemyBuilding, ownUnit, serverGame } from './phase1-helpers';

function zoneFor(game: Game, reserved = false): NeutralMatchResult {
  return {
    phase: 'finished',
    winnerTeam: 0,
    reason: 'elimination',
    tick: game.state.tick,
    teams: [
      { team: 0, playerIds: [0], defeated: false, score: reserved ? 4321 : 1234 },
      { team: 1, playerIds: [1], defeated: true, score: 9999 },
    ],
  };
}

function syncFor(
  game: Game,
  team: number,
  result?: NeutralMatchResult,
): SyncMessage {
  return syncMessage(createTeamSnapshot(game, team, game.state.eventSeq, result));
}

function deltaFor(
  game: Game,
  team: number,
  baselineState: ReturnType<typeof createTeamSnapshot>,
  seq: number,
  base: number,
): ReturnType<typeof deltaMessage> {
  const state = createTeamState(game, team, game.state.eventSeq);
  const fog = game.state.fog[team];
  return deltaMessage({
    seq,
    base,
    tick: game.state.tick,
    team,
    changes: buildDelta(createBaseline(baselineState), state, fog),
  });
}

describe('Phase 2A.4 team delta and client reconstruction', () => {
  it('requires a validated initial sync before any delta is accepted', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    expect(assembler.ready).toBe(false);
    expect(assembler.apply(syncFor(game, 0))).toMatchObject({ ok: true, kind: 'sync' });
    expect(assembler.ready).toBe(true);
    expect(assembler.state()?.map).toEqual(projectMap(game));

    const late = newAssembler(0);
    expect(
      late.apply(deltaMessage({ seq: 2, base: 1, tick: 1, changes: {} })),
    ).toMatchObject({ ok: false, reason: 'not-ready', needsResync: true });
  });

  it('rejects unsupported versions and malformed initial payloads without a baseline', () => {
    const game = serverGame();
    const good = syncFor(game, 0);
    expect(
      newAssembler(0).apply({ ...good, v: 1 }),
    ).toMatchObject({ ok: false, reason: 'version' });

    const shortFog = {
      ...good,
      state: { ...good.state, fog: good.state.fog.slice(0, 10) },
    };
    expect(newAssembler(0).apply(shortFog)).toMatchObject({ ok: false, reason: 'malformed' });

    const shortMap = {
      ...good,
      state: { ...good.state, map: { ...good.state.map, terrain: [1, 2, 3] } },
    };
    expect(newAssembler(0).apply(shortMap)).toMatchObject({ ok: false, reason: 'malformed' });

    const smuggled = { ...good, state: { ...good.state, scenario: { seed: 1 } } };
    expect(newAssembler(0).apply(smuggled)).toMatchObject({ ok: false, reason: 'malformed' });

  });

  it('accepts visible neutral authored structures with owner and team -1', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    const snapshot = createTeamSnapshot(game, 0, game.state.eventSeq);
    const neutral = {
      id: 9000,
      kind: 'building' as const,
      defId: 'relay',
      owner: -1,
      team: -1,
      x: TILE_SIZE * 10,
      z: TILE_SIZE * 10,
      facing: 0,
      turretFacing: 0,
      hp: 500,
      maxHp: 500,
      state: 'idle' as const,
      buildProgress: 1,
      construction: false,
    };
    snapshot.entities.push(neutral);
    applyOk(assembler, syncMessage(snapshot));
    expect(assembler.state()?.entities.find((entity) => entity.id === 9000)).toMatchObject({
      owner: -1,
      team: -1,
      hp: 500,
    });
    applyOk(
      assembler,
      deltaMessage({
        seq: 2,
        base: 1,
        tick: game.state.tick,
        changes: { entities: { upsert: [{ ...neutral, hp: 400 }], remove: [] } },
      }),
    );
    expect(assembler.state()?.entities.find((entity) => entity.id === 9000)?.hp).toBe(400);
  });

  it('reconstructs both teams exactly from ordered deltas', () => {
    const game = serverGame();
    const teams = [0, 1] as const;
    const assemblers = teams.map((team) => newAssembler(team));
    const baselines = new Map<number, ReturnType<typeof createTeamSnapshot>>();
    const sequences = new Map<number, number>();
    for (const team of teams) {
      applyOk(assemblers[team], syncFor(game, team));
      baselines.set(team, assemblers[team].state()!);
      sequences.set(team, 1);
    }

    for (let step = 0; step < 80; step++) {
      game.tick();
      for (const team of teams) {
        const assembler = assemblers[team];
        const seq = sequences.get(team)! + 1;
        const next = deltaFor(game, team, baselines.get(team)!, seq, seq - 1);
        applyOk(assembler, next);
        sequences.set(team, seq);
        baselines.set(team, assembler.state()!);
        expect(canonicalState(assembler.state()!)).toBe(
          canonicalState(createTeamSnapshot(game, team, game.state.eventSeq)),
        );
      }
    }
  });

  it('sends only changed fog tiles and reconstructs own-team fog', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const baseline = assembler.state()!;
    const tiles = baseline.map.width * baseline.map.height;
    const changed = baseline.fog.findIndex((value) => value !== 2);
    expect(changed).toBeGreaterThanOrEqual(0);
    game.state.fog[0][changed] = 2;
    game.state.fog[0][changed + 1] = 1;
    const state = createTeamState(game, 0, game.state.eventSeq);
    const changes = buildDelta(createBaseline(baseline), state, game.state.fog[0]);
    expect(changes.fog?.set).toEqual([
      [changed, 2],
      [changed + 1, 1],
    ]);
    expect(changes.fog!.set.length).toBeLessThan(tiles);
    expect(JSON.stringify(changes)).not.toContain('"map"');
    applyOk(assembler, deltaMessage({ seq: 2, base: 1, tick: state.tick, changes }));
    expect(assembler.state()?.fog).toEqual(Array.from(game.state.fog[0]));
  });

  it('upserts movement and removes destroyed own entities', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const baseline = assembler.state()!;
    const unit = ownUnit(game, 0, 'tank');
    const startX = unit.x;
    unit.x += TILE_SIZE;
    unit.facing += 0.25;

    let changes = buildDelta(
      createBaseline(baseline),
      createTeamState(game, 0, game.state.eventSeq),
      game.state.fog[0],
    );
    expect(changes.entities?.upsert.some((entity) => entity.id === unit.id)).toBe(true);
    expect(changes.entities?.upsert.some((entity) => entity.id === 0)).toBe(false);
    applyOk(assembler, deltaMessage({ seq: 2, base: 1, tick: game.state.tick, changes }));

    const updated = assembler.state()!.entities.find((entity) => entity.id === unit.id)!;
    expect(updated.x).toBe(startX + TILE_SIZE);
    expect(updated.facing).toBe(unit.facing);

    unit.hp = 0;
    changes = buildDelta(
      createBaseline(assembler.state()!),
      createTeamState(game, 0, game.state.eventSeq),
      game.state.fog[0],
    );
    expect(changes.entities?.remove).toContain(unit.id);
    applyOk(assembler, deltaMessage({ seq: 3, base: 2, tick: game.state.tick, changes }));
    expect(assembler.state()?.entities.some((entity) => entity.id === unit.id)).toBe(false);
  });

  it('carries remembered structures without live state and removes them with ids only', () => {
    const game = serverGame();
    const building = hiddenEnemyBuilding(game, 0);
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const baseline = assembler.state()!;
    game.state.charted.push({ team: 0, entityId: building.id });

    let changes = buildDelta(
      createBaseline(baseline),
      createTeamState(game, 0, game.state.eventSeq),
      game.state.fog[0],
    );
    const remembered = changes.entities?.upsert.find((entity) => entity.id === building.id);
    expect(remembered).toMatchObject({
      remembered: true,
      hp: null,
      maxHp: null,
      state: null,
      buildProgress: null,
    });
    expect(remembered).not.toHaveProperty('queue');
    expect(JSON.stringify(remembered)).not.toContain('targetId');
    applyOk(assembler, deltaMessage({ seq: 2, base: 1, tick: game.state.tick, changes }));
    expect(assembler.state()!.entities.find((entity) => entity.id === building.id)?.remembered).toBe(
      true,
    );

    game.state.charted = [];
    changes = buildDelta(
      createBaseline(assembler.state()!),
      createTeamState(game, 0, game.state.eventSeq),
      game.state.fog[0],
    );
    expect(changes.entities?.remove).toContain(building.id);
    expect(changes.entities?.upsert ?? []).toHaveLength(0);
    applyOk(assembler, deltaMessage({ seq: 3, base: 2, tick: game.state.tick, changes }));
    expect(assembler.state()?.entities.some((entity) => entity.id === building.id)).toBe(false);
  });

  it('adds and expires visible projectiles and appends filtered events', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const shooter = ownUnit(game, 0, 'tank');
    game.state.projectiles.push({
      id: 9001,
      owner: 0,
      shooterId: shooter.id,
      weaponId: 'cannon',
      x: shooter.x,
      y: 0,
      z: shooter.z,
      tx: shooter.x + 10,
      ty: 0,
      tz: shooter.z,
      targetId: 0,
      speed: 10,
      splash: 0,
      kind: 'shell',
      homing: false,
      damage: 10,
      armourMul: {},
      suppression: 0,
      seed: 1,
    });
    const eventSeq = game.state.eventSeq;
    game.state.events.push({
      seq: eventSeq,
      tick: game.state.tick,
      type: 'shot',
      team: 0,
      x: shooter.x,
      z: shooter.z,
      text: 'TEST SHOT',
      entityId: shooter.id,
    });
    game.state.eventSeq = eventSeq + 1;

    let changes = buildDelta(
      createBaseline(assembler.state()!),
      createTeamState(game, 0, eventSeq - 1),
      game.state.fog[0],
    );
    expect(changes.projectiles?.upsert.map((projectile) => projectile.id)).toEqual([9001]);
    expect(changes.events?.map((event) => event.text)).toEqual(['TEST SHOT']);
    applyOk(assembler, deltaMessage({ seq: 2, base: 1, tick: game.state.tick, changes }));
    expect(assembler.state()?.projectiles[0]).toMatchObject({ id: 9001, x: shooter.x });
    expect(assembler.state()?.events.map((event) => event.text)).toEqual(['TEST SHOT']);

    game.state.projectiles = [];
    changes = buildDelta(
      createBaseline(assembler.state()!),
      createTeamState(game, 0, game.state.eventSeq),
      game.state.fog[0],
    );
    expect(changes.projectiles?.remove).toEqual([9001]);
    applyOk(assembler, deltaMessage({ seq: 3, base: 2, tick: game.state.tick, changes }));
    expect(assembler.state()?.projectiles).toHaveLength(0);
  });

  it('updates the team-relative result without exposing the opponent score', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    const result = zoneFor(game, true);
    applyOk(assembler, syncFor(game, 0, result));
    expect(assembler.state()?.result.teams.find((team) => team.team === 0)?.score).toBe(4321);
    expect(assembler.state()?.result.teams.find((team) => team.team === 1)?.score).toBeNull();

    const changed: NeutralMatchResult = {
      ...result,
      tick: game.state.tick + 1,
      reason: 'time-limit',
    };
    const changes: DeltaChanges = {
      result: createTeamSnapshot(game, 0, game.state.eventSeq, changed).result,
    };
    applyOk(
      assembler,
      deltaMessage({ seq: 2, base: 1, tick: game.state.tick + 1, changes }),
    );
    expect(assembler.state()?.result).toMatchObject({ reason: 'time-limit', tick: game.state.tick + 1 });
  });

  it('rejects a delta atomically when any part of it is malformed', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const before = assembler.state()!;
    const fogBefore = [...before.fog];
    const firstForg = before.fog.findIndex((value) => value !== 2);
    const changes = {
      fog: { set: [[firstForg, 2]] },
      entities: { upsert: [{ id: 1, kind: 'unit' }], remove: [] },
    };
    const applied = assembler.apply(
      deltaMessage({ seq: 2, base: 1, tick: 1, changes: changes as unknown as DeltaChanges }),
    );
    expect(applied).toMatchObject({ ok: false, reason: 'malformed', needsResync: true });
    expect(assembler.state()?.fog).toEqual(fogBefore);
    expect(assembler.seq).toBe(1);
  });

  it('distinguishes duplicate, stale, gapped and wrong-base deltas', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const tick = game.state.tick;

    expect(assembler.apply(deltaMessage({ seq: 1, base: 0, tick, changes: {} }))).toMatchObject({
      ok: false,
      reason: 'sequence-duplicate',
    });
    expect(assembler.apply(deltaMessage({ seq: 4, base: 3, tick, changes: {} }))).toMatchObject({
      ok: false,
      reason: 'base-mismatch',
    });
    expect(assembler.apply(deltaMessage({ seq: 3, base: 1, tick, changes: {} }))).toMatchObject({
      ok: false,
      reason: 'sequence-gap',
    });
    expect(assembler.apply(deltaMessage({ seq: 2, base: 1, tick, changes: {} }))).toMatchObject({
      ok: true,
    });
    expect(assembler.apply(deltaMessage({ seq: 2, base: 1, tick, changes: {} }))).toMatchObject({
      ok: false,
      reason: 'sequence-duplicate',
    });
    expect(assembler.apply(deltaMessage({ seq: 1, base: 0, tick, changes: {} }))).toMatchObject({
      ok: false,
      reason: 'sequence-stale',
    });
  });

  it('rejects messages from another epoch, room or team', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const tick = game.state.tick;

    expect(
      assembler.apply(deltaMessage({ seq: 2, base: 1, tick, epoch: 2, changes: {} })),
    ).toMatchObject({ ok: false, reason: 'epoch-mismatch' });
    expect(
      assembler.apply(deltaMessage({ seq: 2, base: 1, tick, roomId: 'other', changes: {} })),
    ).toMatchObject({ ok: false, reason: 'room-mismatch' });
    expect(
      assembler.apply(deltaMessage({ seq: 2, base: 1, tick, team: 1, changes: {} })),
    ).toMatchObject({ ok: false, reason: 'team-mismatch' });
    expect(
      assembler.apply(deltaMessage({ seq: 2, base: 1, tick, epoch: 1, changes: { scenario: {} } as unknown as DeltaChanges })),
    ).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('accepts a new generation only when its epoch advances', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    expect(assembler.apply(syncFor(game, 0))).toMatchObject({ ok: false, reason: 'epoch-mismatch' });
    applyOk(assembler, syncMessage(createTeamSnapshot(game, 0, game.state.eventSeq), {
      epoch: 2,
      seq: 7,
      checkpoint: true,
    }));
    expect(assembler.epoch).toBe(2);
    expect(assembler.seq).toBe(7);
    applyOk(assembler, deltaMessage({ epoch: 2, seq: 8, base: 7, tick: game.state.tick, changes: {} }));
  });

  it('rejects a malformed fog entry without partially applying the delta', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncFor(game, 0));
    const tiles = assembler.state()!.map.width * assembler.state()!.map.height;
    const cases: unknown[] = [
      { set: [[tiles, 2]] },
      { set: [[0, 3]] },
      { set: [[0, 2], [0, 2]] },
      { set: [[0, 2]], extra: true },
      { set: 'nope' },
    ];
    for (const fog of cases) {
      const before = [...assembler.state()!.fog];
      expect(
        assembler.apply(
          deltaMessage({ seq: 2, base: 1, tick: 1, changes: { fog } as unknown as DeltaChanges }),
        ),
      ).toMatchObject({ ok: false, reason: 'malformed' });
      expect(assembler.state()?.fog).toEqual(before);
      expect(assembler.seq).toBe(1);
    }
  });

  it('rejects a delta that wraps the sequence instead of applying it', () => {
    const game = serverGame();
    const assembler = newAssembler(0);
    applyOk(assembler, syncMessage(createTeamSnapshot(game, 0, game.state.eventSeq), { seq: 4 }));
    expect(
      assembler.apply(deltaMessage({ seq: 1, base: 0, tick: game.state.tick, changes: {} })),
    ).toMatchObject({ ok: false, reason: 'sequence-stale' });
  });
});
