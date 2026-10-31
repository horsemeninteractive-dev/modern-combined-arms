import { CommandGate } from '../src/multiplayer/commandGate';
import { TILE_SIZE } from '../src/sim/constants';
import {
  hiddenEnemyBuilding,
  hiddenEnemyUnit,
  ownUnit,
  serverGame,
  twoSeats,
} from './phase1-helpers';

function envelope(command: unknown): { v: 1; command: unknown } {
  return { v: 1, command };
}

function buildGate(options: ConstructorParameters<typeof CommandGate>[2] = {}) {
  const game = serverGame();
  const gate = new CommandGate(game, twoSeats(), options);
  return { game, gate };
}

describe('Phase 1 command gate', () => {
  it('rejects every client-selected authority field before the queue', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    for (const [index, field] of ['team', 'playerId', 'owner', 'seat'].entries()) {
      const result = gate.submit(
        0,
        envelope({ type: 'stop', ids: [unit.id], [field]: 1 }),
        1000 + index * 100,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('forbidden-field');
    }
    expect(game.pending).toHaveLength(0);
  });

  it('requires exact entity ownership, not merely the same team', () => {
    const { game, gate } = buildGate();
    const enemy = ownUnit(game, 1);
    const result = gate.submit(0, envelope({ type: 'stop', ids: [enemy.id] }), 1000);
    expect(result).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(game.pending).toHaveLength(0);
  });

  it('rejects hidden attack targets without leaking their identity', () => {
    const { game, gate } = buildGate();
    const attacker = ownUnit(game, 0, 'tank');
    const hidden = hiddenEnemyUnit(game, 0);
    const result = gate.submit(
      0,
      envelope({ type: 'attack', ids: [attacker.id], targetId: hidden.id }),
      1000,
    );
    expect(result).toMatchObject({ ok: false, code: 'target-hidden' });
    if (!result.ok) expect(result.message).not.toContain(String(hidden.id));
    expect(game.pending).toHaveLength(0);
  });

  it('cannot use rejection codes to discover hidden entities', () => {
    const { game, gate } = buildGate();
    const hiddenUnit = hiddenEnemyUnit(game, 0);
    const hiddenBuilding = hiddenEnemyBuilding(game, 0);
    const missingId = 987654;
    const attacker = ownUnit(game, 0, 'tank');
    let now = 1000;
    const code = (command: unknown): string => {
      now += 150;
      const result = gate.submit(0, envelope(command), now);
      return result.ok ? 'ok' : result.code;
    };

    // Selection and production must not distinguish "hidden" from "missing".
    expect(code({ type: 'stop', ids: [hiddenUnit.id] })).toBe('not-your-entity');
    expect(code({ type: 'stop', ids: [missingId] })).toBe('not-your-entity');
    expect(
      code({ type: 'produce', buildingId: hiddenBuilding.id, defId: 'tank' }),
    ).toBe('not-your-entity');
    expect(code({ type: 'produce', buildingId: missingId, defId: 'tank' })).toBe(
      'not-your-entity',
    );
    expect(code({ type: 'ungarrison', ids: [hiddenBuilding.id] })).toBe('not-your-entity');
    expect(code({ type: 'ungarrison', ids: [missingId] })).toBe('not-your-entity');

    // Attack has its own stable "not visible" code for both cases.
    expect(
      code({ type: 'attack', ids: [attacker.id], targetId: hiddenUnit.id }),
    ).toBe('target-hidden');
    expect(code({ type: 'attack', ids: [attacker.id], targetId: missingId })).toBe(
      'target-hidden',
    );
    expect(game.pending).toHaveLength(0);
  });

  it('rejects unknown command types and unknown fields', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    const unknownType = gate.submit(
      0,
      envelope({ type: 'teleport', ids: [unit.id] }),
      1000,
    );
    expect(unknownType).toMatchObject({ ok: false, code: 'command-not-allowed' });
    const unknownField = gate.submit(
      0,
      envelope({ type: 'stop', ids: [unit.id], nope: true }),
      1100,
    );
    expect(unknownField).toMatchObject({ ok: false, code: 'unknown-field' });
    expect(game.pending).toHaveLength(0);
  });

  it('rejects oversized batches and out-of-map coordinates', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    const ids = Array.from({ length: 65 }, (_, index) => index + 1);
    expect(gate.submit(0, envelope({ type: 'stop', ids }), 1000)).toMatchObject({
      ok: false,
      code: 'too-many-ids',
    });
    expect(
      gate.submit(
        0,
        envelope({
          type: 'move',
          ids: [unit.id],
          x: game.state.map.width * TILE_SIZE + 1,
          z: unit.z,
        }),
        1100,
      ),
    ).toMatchObject({ ok: false, code: 'out-of-bounds' });
    expect(game.pending).toHaveLength(0);
  });

  it('rate-limits one batch per seat per interval', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    expect(gate.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000).ok).toBe(true);
    expect(gate.submit(0, envelope({ type: 'hold', ids: [unit.id] }), 1050)).toMatchObject({
      ok: false,
      code: 'rate-limited',
    });
    expect(gate.submit(0, envelope({ type: 'hold', ids: [unit.id] }), 1100).ok).toBe(true);
    expect(game.pending).toHaveLength(2);
  });

  it('rejects all commands after the authoritative match end', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    gate.endMatch();
    expect(gate.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000)).toMatchObject({
      ok: false,
      code: 'match-ended',
    });
    expect(game.pending).toHaveLength(0);
  });

  it('rejects inactive, mismatched and defeated seats', () => {
    const game = serverGame();
    const inactive = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: false },
    ]);
    const unit = ownUnit(game);
    expect(inactive.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000)).toMatchObject({
      ok: false,
      code: 'seat-inactive',
    });

    const mismatched = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 1, active: true },
    ]);
    expect(mismatched.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000)).toMatchObject({
      ok: false,
      code: 'seat-mismatch',
    });

    game.player(0)!.defeated = true;
    const defeated = new CommandGate(game, twoSeats());
    expect(defeated.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000)).toMatchObject({
      ok: false,
      code: 'player-defeated',
    });
    expect(game.pending).toHaveLength(0);
  });

  it('validates placement, production and rally preconditions', () => {
    const { game, gate } = buildGate();
    const building = game.state.entities.find(
      (entity) => entity.kind === 'building' && entity.owner === 0,
    )!;
    expect(
      gate.submit(
        0,
        envelope({ type: 'placeBuilding', defId: 'barracks', tileX: 0, tileZ: 0 }),
        1000,
      ),
    ).toMatchObject({ ok: false, code: 'placement-invalid' });
    expect(
      gate.submit(
        0,
        envelope({ type: 'produce', buildingId: building.id, defId: 'tank' }),
        1100,
      ),
    ).toMatchObject({ ok: false, code: 'production-unavailable' });
    expect(
      gate.submit(
        0,
        envelope({ type: 'setRally', buildingId: building.id, x: -1, z: 0 }),
        1200,
      ),
    ).toMatchObject({ ok: false, code: 'out-of-bounds' });
    expect(game.pending).toHaveLength(0);
  });

  it('rejects oversized payload text before parsing', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    const result = gate.submitText(
      0,
      JSON.stringify(envelope({ type: 'stop', ids: [unit.id], padding: 'x'.repeat(5000) })),
      1000,
    );
    expect(result).toMatchObject({ ok: false, code: 'payload-too-large' });
    expect(game.pending).toHaveLength(0);
  });

  it('accepts a valid command and only then queues it', () => {
    const { game, gate } = buildGate();
    const unit = ownUnit(game);
    const result = gate.submit(0, envelope({ type: 'stop', ids: [unit.id] }), 1000);
    expect(result).toMatchObject({ ok: true, queued: true });
    expect(game.pending).toHaveLength(1);
    if (result.ok) expect(result.command).toMatchObject({ type: 'stop', team: 0, ids: [unit.id] });
  });
});
