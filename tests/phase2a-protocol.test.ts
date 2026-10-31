import {
  MAX_CLIENT_MESSAGE_BYTES,
  parseClientMessage,
  resultMessageFor,
  ROOM_PROTOCOL_VERSION,
} from '../src/multiplayer/protocol';
import type { NeutralMatchResult } from '../src/multiplayer/matchResult';
import type { ProjectedMatchResult } from '../src/multiplayer/projection';

function result(winnerTeam: number | null): NeutralMatchResult {
  return {
    phase: 'finished',
    winnerTeam,
    reason: winnerTeam === null ? 'draw' : 'elimination',
    tick: 10,
    teams: [
      { team: 0, playerIds: [0], defeated: false, score: 10 },
      { team: 1, playerIds: [1], defeated: false, score: 10 },
    ],
  };
}

function projected(): ProjectedMatchResult {
  return {
    phase: 'finished',
    winnerTeam: 0,
    reason: 'elimination',
    tick: 10,
    teams: [
      { team: 0, playerIds: [0], defeated: false, score: 10 },
      { team: 1, playerIds: [1], defeated: false, score: null },
    ],
  };
}

describe('Phase 2A wire protocol', () => {
  it('accepts only the versioned command envelope', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          v: ROOM_PROTOCOL_VERSION,
          command: { type: 'stop', ids: [1] },
        }),
      ),
    ).toMatchObject({ ok: true, message: { type: 'command' } });
  });

  it('rejects unknown fields, unsupported versions, wrong types and arrays', () => {
    const valid = {
      type: 'command',
      v: ROOM_PROTOCOL_VERSION,
      command: { type: 'stop', ids: [1] },
    };
    expect(parseClientMessage(JSON.stringify({ ...valid, extra: true }))).toMatchObject({
      ok: false,
      code: 'unknown-field',
    });
    expect(parseClientMessage(JSON.stringify({ ...valid, v: 3 }))).toMatchObject({
      ok: false,
      code: 'unsupported-version',
    });
    expect(parseClientMessage(JSON.stringify({ ...valid, type: 'hello' }))).toMatchObject({
      ok: false,
      code: 'unsupported-message-type',
    });
    expect(parseClientMessage(JSON.stringify([valid]))).toMatchObject({
      ok: false,
      code: 'malformed-message',
    });
    expect(parseClientMessage('{')).toMatchObject({
      ok: false,
      code: 'malformed-message',
    });
    expect(parseClientMessage('x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1))).toMatchObject({
      ok: false,
      code: 'payload-too-large',
    });
  });

  it('accepts a versioned resync request and nothing else', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'resync', v: ROOM_PROTOCOL_VERSION }))).toMatchObject(
      { ok: true, message: { type: 'resync' } },
    );
    expect(
      parseClientMessage(JSON.stringify({ type: 'resync', v: ROOM_PROTOCOL_VERSION, seat: 0 })),
    ).toMatchObject({ ok: false, code: 'unknown-field' });
    expect(parseClientMessage(JSON.stringify({ type: 'resync', v: 1 }))).toMatchObject({
      ok: false,
      code: 'unsupported-version',
    });
  });

  it('produces a stable result view for each recipient and never for a live match', () => {
    const neutral = result(0);
    expect(resultMessageFor(neutral, projected(), 0)).toMatchObject({ outcome: 'victory' });
    expect(resultMessageFor(neutral, projected(), 1)).toMatchObject({ outcome: 'defeat' });
    const draw = result(null);
    expect(resultMessageFor(draw, projected(), 0)).toMatchObject({ outcome: 'draw' });
    expect(() =>
      resultMessageFor(
        { ...neutral, phase: 'playing', winnerTeam: null, reason: null },
        { ...projected(), phase: 'playing' },
        0,
      ),
    ).toThrow('live match');
  });
});
