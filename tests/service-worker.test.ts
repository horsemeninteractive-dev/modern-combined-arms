import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
  cache?: RequestCache;
  headers: Headers;
}

interface FetchEventLike {
  request: FakeRequest;
  respondWith(response: Promise<Response>): void;
}

type FetchHandler = (event: FetchEventLike) => void;

function request(
  path: string,
  options: { mode?: string; cache?: RequestCache; headers?: Record<string, string> } = {},
): FakeRequest {
  return {
    method: 'GET',
    url: `https://moderncombinedarms.pages.dev${path}`,
    mode: options.mode ?? 'cors',
    cache: options.cache,
    headers: new Headers(options.headers),
  };
}

function harness(fetchImpl: (req: FakeRequest) => Promise<Response>) {
  const listeners = new Map<string, FetchHandler>();
  const cached: string[] = [];
  const fetched: string[] = [];
  const cache = {
    async put(req: FakeRequest) {
      cached.push(req.url);
    },
    async add() {
      /* install is not exercised here */
    },
  };
  const caches = {
    async open() {
      return cache;
    },
    async match() {
      return undefined;
    },
    async keys() {
      return [];
    },
    async delete() {
      return true;
    },
  };
  const self = {
    location: { origin: 'https://moderncombinedarms.pages.dev' },
    addEventListener(type: string, handler: FetchHandler) {
      listeners.set(type, handler);
    },
    async skipWaiting() {},
    clients: { async claim() {} },
  };

  runInNewContext(source, {
    self,
    caches,
    fetch: async (req: FakeRequest) => {
      fetched.push(req.url);
      return fetchImpl(req);
    },
    Response,
    URL,
    console,
  });

  const handler = listeners.get('fetch');
  if (!handler) throw new Error('service worker did not register a fetch handler');

  return {
    cached,
    fetched,
    async dispatch(req: FakeRequest): Promise<Response | undefined> {
      let response: Promise<Response> | undefined;
      handler({
        request: req,
        respondWith(value) {
          response = value;
        },
      });
      if (!response) return undefined;
      const value = await response;
      // The runtime cache write is deliberately fire-and-forget. Give it a
      // microtask/timer turn before asserting that it did or did not happen.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return value;
    },
  };
}

describe('service worker cache boundary', () => {
  it('never intercepts or caches API requests', async () => {
    const worker = harness(async () => new Response('{}', { status: 200 }));
    expect(await worker.dispatch(request('/api'))).toBeUndefined();
    expect(await worker.dispatch(request('/api/rooms'))).toBeUndefined();
    expect(await worker.dispatch(request('/api/rooms', { mode: 'navigate' }))).toBeUndefined();
    expect(worker.fetched).toEqual([]);
    expect(worker.cached).toEqual([]);
  });

  it('never caches a credentialed static request', async () => {
    const worker = harness(async () => new Response('asset', { status: 200 }));
    expect(
      await worker.dispatch(request('/app.js', { headers: { Authorization: 'Bearer test' } })),
    ).toBeUndefined();
    expect(worker.fetched).toEqual([]);
    expect(worker.cached).toEqual([]);
  });

  it('bypasses a caller that explicitly requests no-store', async () => {
    const worker = harness(async () => new Response('asset', { status: 200 }));
    expect(await worker.dispatch(request('/app.js', { cache: 'no-store' }))).toBeUndefined();
    expect(worker.fetched).toEqual([]);
    expect(worker.cached).toEqual([]);
  });

  it('caches an ordinary public asset', async () => {
    const worker = harness(
      async () =>
        new Response('asset', {
          status: 200,
          headers: { 'Cache-Control': 'public, max-age=60' },
        }),
    );
    await worker.dispatch(request('/flags/uk.png'));
    expect(worker.fetched).toEqual(['https://moderncombinedarms.pages.dev/flags/uk.png']);
    expect(worker.cached).toEqual(['https://moderncombinedarms.pages.dev/flags/uk.png']);
  });

  it('refuses to cache a response reached through a redirect', async () => {
    const worker = harness(async () => {
      const response = new Response('private', { status: 200 });
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });
    await worker.dispatch(request('/legacy-route'));
    expect(worker.cached).toEqual([]);
  });

  it.each([
    ['Set-Cookie', { 'Set-Cookie': 'session=secret' }],
    ['no-store', { 'Cache-Control': 'no-store' }],
    ['private', { 'Cache-Control': 'private, max-age=60' }],
    ['Vary: Cookie', { Vary: 'Cookie' }],
    ['Vary: Authorization', { Vary: 'Authorization' }],
    ['Vary: *', { Vary: '*' }],
    ['206 partial', {}],
  ])('refuses to cache a response marked %s', async (_label, headers) => {
    const worker = harness(
      async () =>
        new Response('asset', {
          status: _label === '206 partial' ? 206 : 200,
          headers,
        }),
    );
    await worker.dispatch(request('/app.js'));
    expect(worker.cached).toEqual([]);
  });
});
