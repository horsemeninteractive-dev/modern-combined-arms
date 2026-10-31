/**
 * The deployed room worker's public surface.
 *
 * These tests pin the differences between a development runtime and a live
 * one: a live worker has development mode off (no probe page, no loopback
 * exemption) and refuses a browser origin it was not configured for *before*
 * the request reaches a room, because a missing CORS grant hides the reply but
 * does not stop a room from being created and spending a capacity slot.
 */
import { describe, expect, it, vi } from 'vitest';

// The worker build inlines the browser assembler as a string through a Vite
// virtual module. The surface under test never reads it, so it is stubbed the
// same way the raw import is a build-time string.
vi.mock('virtual:mca-assembler', () => ({ default: '' }));

import worker from '../src/multiplayer/roomWorker';
import type { MatchRoomEnv } from '../src/multiplayer/roomDurableObject';
import { originPermitted } from '../src/multiplayer/originPolicy';

const WORKER_ORIGIN = 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
const LIVE_APP_ORIGIN = 'https://moderncombinedarms.pages.dev';
const PREVIEW_APP_ORIGIN = 'https://abc123.moderncombinedarms.pages.dev';
const LIVE_ALLOWLIST = `${WORKER_ORIGIN},${LIVE_APP_ORIGIN},https://*.moderncombinedarms.pages.dev`;

/** The live configuration: no `MP_DEV_MODE`, allowlist only. */
function liveEnv(overrides: Partial<MatchRoomEnv> = {}): MatchRoomEnv {
  return {
    ROOMS: {} as DurableObjectNamespace,
    CAPACITY: {} as DurableObjectNamespace,
    MP_ONLINE_ENABLED: '1',
    MP_ALLOWED_ORIGINS: LIVE_ALLOWLIST,
    MP_DEFAULT_MATCH_SECONDS: '60',
    MP_MAX_MATCH_SECONDS: '1800',
    ...overrides,
  };
}

/** A namespace that records whether the worker reached it. */
function recordingRooms(): { namespace: DurableObjectNamespace; calls: string[] } {
  const calls: string[] = [];
  const stub = {
    fetch: async () => {
      calls.push('reached');
      return new Response(JSON.stringify({ ok: true, reached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const namespace = {
    idFromName: () => ({ toString: () => 'id' }) as DurableObjectId,
    idFromObject: () => ({ toString: () => 'id' }) as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    newUniqueId: () => ({ toString: () => 'id' }) as DurableObjectId,
    jurisdiction: () => namespace,
  } as unknown as DurableObjectNamespace;
  return { namespace, calls };
}

/**
 * A bodyless room action, so the assertions are about the origin gate rather
 * than about a request body being re-streamed through the test runtime.
 */
function actionRequest(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return new Request(`${WORKER_ORIGIN}/api/multiplayer/rooms/live-room/snapshot`, {
    method: 'GET',
    headers,
  });
}

describe('Phase 2B.4 live origin policy', () => {
  it('admits exact origins and one-label preview hosts', () => {
    expect(originPermitted(LIVE_APP_ORIGIN, LIVE_ALLOWLIST)).toBe(true);
    expect(originPermitted(PREVIEW_APP_ORIGIN, LIVE_ALLOWLIST)).toBe(true);
    expect(originPermitted(WORKER_ORIGIN, LIVE_ALLOWLIST)).toBe(true);
  });

  it('refuses a lookalike host, another domain and a nested subdomain', () => {
    expect(originPermitted('https://moderncombinedarms.pages.dev.evil.example', LIVE_ALLOWLIST)).toBe(
      false,
    );
    expect(originPermitted('https://evil.example', LIVE_ALLOWLIST)).toBe(false);
    expect(originPermitted('https://deep.abc.moderncombinedarms.pages.dev', LIVE_ALLOWLIST)).toBe(
      false,
    );
    // A wildcard entry never widens the scheme or the port.
    expect(originPermitted('http://abc123.moderncombinedarms.pages.dev', LIVE_ALLOWLIST)).toBe(false);
    expect(originPermitted('https://abc123.moderncombinedarms.pages.dev:8443', LIVE_ALLOWLIST)).toBe(
      false,
    );
    expect(originPermitted(PREVIEW_APP_ORIGIN, '')).toBe(false);
  });
});

describe('Phase 2B.4 deployed room worker', () => {
  it('refuses a browser origin that is not allowlisted before a room is touched', async () => {
    const rooms = recordingRooms();
    const response = await worker.fetch(
      actionRequest('https://evil.example'),
      liveEnv({ ROOMS: rooms.namespace }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      ok: false,
      code: 'origin-rejected',
    });
    expect(rooms.calls).toHaveLength(0);
  });

  it('admits the live app origin it was configured for', async () => {
    const rooms = recordingRooms();
    const response = await worker.fetch(
      actionRequest(LIVE_APP_ORIGIN),
      liveEnv({ ROOMS: rooms.namespace }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(LIVE_APP_ORIGIN);
    expect(rooms.calls).toHaveLength(1);
  });

  it('keeps server-side callers working, because a browser cannot omit Origin', async () => {
    const rooms = recordingRooms();
    const response = await worker.fetch(actionRequest(), liveEnv({ ROOMS: rooms.namespace }));
    expect(response.status).toBe(200);
    expect(rooms.calls).toHaveLength(1);
  });

  it('admits a preview host the allowlist wildcard covers', async () => {
    const rooms = recordingRooms();
    const response = await worker.fetch(
      actionRequest(PREVIEW_APP_ORIGIN),
      liveEnv({ ROOMS: rooms.namespace }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW_APP_ORIGIN);
  });

  it('answers the health probe without exposing a development surface', async () => {
    const response = await worker.fetch(
      new Request(`${WORKER_ORIGIN}/api/multiplayer/health`),
      liveEnv(),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, devMode: false, onlineEnabled: true });

    const devPage = await worker.fetch(
      new Request(`${WORKER_ORIGIN}/api/multiplayer/dev`),
      liveEnv(),
    );
    expect(devPage.status).toBe(404);
  });

  it('reports online play disabled rather than pretending a room exists', async () => {
    const rooms = recordingRooms();
    const response = await worker.fetch(
      actionRequest(),
      liveEnv({ ROOMS: rooms.namespace, MP_ONLINE_ENABLED: '0' }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'online-disabled',
    });
    expect(rooms.calls).toHaveLength(0);
  });
});
