import devClientSource from './devRoomClient.js?raw';
import assemblerClientSource from 'virtual:mca-assembler';
import type { MatchRoomEnv } from './roomDurableObject';
import { originPermitted } from './originPolicy';
import { withVerifiedIdentity } from './roomIdentity';

export { MatchRoomDurableObject } from './roomDurableObject';
export { CapacityCoordinatorDurableObject } from './reservationDurableObject';

/**
 * `start` is the only route a player calls with its own seat authority instead
 * of the admin token. The room decides which seat the token belongs to, so the
 * route carries no seat, team or host flag.
 */
const ROOM_ROUTE =
  /^\/api\/multiplayer\/rooms\/([A-Za-z0-9_-]{1,64})(?:\/(ws|status|shutdown|restart|snapshot|start|open|join))?$/;

function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      ...securityHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function onlineEnabled(env: MatchRoomEnv): boolean {
  return env.MP_ONLINE_ENABLED === '1';
}

/**
 * The lobby runs on a different origin from this room worker, so the browser
 * needs an explicit CORS grant. Origins are allowlisted by configuration; the
 * development flag additionally admits loopback pages so a local room worker
 * can be driven by `npm run dev`. Nothing else is ever echoed back, and the
 * grant never carries credentials — seat authority is a bearer token in the
 * request, not a cookie.
 */
function corsOrigin(request: Request, env: MatchRoomEnv): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin) return origin;
  if (originPermitted(origin, env.MP_ALLOWED_ORIGINS)) return origin;
  if (env.MP_DEV_MODE === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)) {
    return origin;
  }
  return null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MCA-Identity-Ticket',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    // The security headers the room sends assume same-origin reads; a grant we
    // deliberately extended is not a same-origin read.
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

function withCors(request: Request, env: MatchRoomEnv, response: Response): Response {
  const origin = corsOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function devEnabled(env: MatchRoomEnv): boolean {
  return env.MP_DEV_MODE === '1';
}

function devPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCA multiplayer staging probe</title>
<style>
  :root { color-scheme: dark; --line:#2a3b46; --ink:#d7e3ea; --dim:#8fa3af; --accent:#4fd1c5; --bad:#f26d6d; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:#0b1115; color:var(--ink); }
  main { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 20px; letter-spacing:.08em; text-transform:uppercase; margin:0 0 4px; }
  p.lead { color:var(--dim); margin:0 0 24px; }
  .panel { border:1px solid var(--line); background:#0f171d; padding:16px; margin-bottom:16px; }
  label { display:block; color:var(--dim); font-size:12px; margin:10px 0 4px; text-transform:uppercase; letter-spacing:.06em; }
  input { width:100%; padding:8px 10px; border:1px solid var(--line); background:#0a1014; color:var(--ink); font:inherit; }
  .row { display:flex; gap:10px; flex-wrap:wrap; }
  .row > * { flex:1 1 160px; }
  button { border:1px solid var(--accent); background:transparent; color:var(--accent); padding:8px 14px; font:inherit; cursor:pointer; }
  button:hover { background:rgba(79,209,197,.1); }
  button:disabled { opacity:.4; cursor:not-allowed; }
  pre { white-space:pre-wrap; word-break:break-word; background:#080d10; border:1px solid var(--line); padding:12px; min-height:120px; max-height:340px; overflow:auto; margin:0; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
  .tag { display:inline-block; border:1px solid var(--line); color:var(--dim); padding:1px 7px; margin-right:6px; font-size:12px; }
  .ok { color:var(--accent); } .bad { color:var(--bad); }
</style>
</head>
<body>
<main>
  <h1>MCA multiplayer staging probe</h1>
  <p class="lead">Development transport only. No production lobby, accounts or room discovery. This page is served by the isolated staging Worker.</p>
  <section class="panel">
    <div class="row">
      <div><label for="room">Room id</label><input id="room" value="probe-01" autocomplete="off"></div>
      <div><label for="admin">Admin token (header only)</label><input id="admin" type="password" autocomplete="off"></div>
      <div><label for="duration">Duration (seconds, 10-1800)</label><input id="duration" type="number" min="10" max="1800" value="60"></div>
    </div>
    <div class="row" style="margin-top:14px">
      <button id="create">Create / resume room</button>
      <button id="status" disabled>Refresh status</button>
      <button id="shutdown" disabled>Shut room down</button>
    </div>
  </section>
  <div class="grid">
    <section class="panel">
      <div style="margin-bottom:8px"><span class="tag">seat 0</span><span id="s0-state" class="bad">disconnected</span></div>
      <button id="s0-connect" disabled>Connect seat 0</button>
      <pre id="s0-log" style="margin-top:12px"></pre>
    </section>
    <section class="panel">
      <div style="margin-bottom:8px"><span class="tag">seat 1</span><span id="s1-state" class="bad">disconnected</span></div>
      <button id="s1-connect" disabled>Connect seat 1</button>
      <pre id="s1-log" style="margin-top:12px"></pre>
    </section>
  </div>
  <section class="panel" style="margin-top:16px">
    <label>Last response</label>
    <pre id="response">Create a room to receive seat handles.</pre>
  </section>
</main>
<script type="module" src="/api/multiplayer/dev/client.js"></script>
</body>
</html>`;
}

async function forward(
  request: Request,
  env: MatchRoomEnv,
  roomId: string,
  action: string,
): Promise<Response> {
  const id = env.ROOMS.idFromName(roomId);
  if (action === 'ws') return env.ROOMS.get(id).fetch(request);
  const headers = new Headers(request.headers);
  headers.set('X-MCA-Room-Action', action);
  return env.ROOMS.get(id).fetch(
    new Request(request.url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    }),
  );
}

export default {
  async fetch(request: Request, env: MatchRoomEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/multiplayer/health') {
      return json({
        ok: true,
        onlineEnabled: onlineEnabled(env),
        devMode: devEnabled(env),
        adminConfigured: Boolean(env.MP_ADMIN_TOKEN),
        reservationConfigured: Boolean(env.MCA_RESERVATION_TOKEN),
        protocol: 'mca.v2',
        snapshotVersion: 2,
        build: 'phase2b4-live',
      });
    }
    if (url.pathname === '/api/multiplayer/dev' || url.pathname === '/api/multiplayer/dev/') {
      if (!devEnabled(env)) return json({ ok: false, code: 'not-found' }, 404);
      return html(devPage());
    }
    if (
      url.pathname === '/api/multiplayer/dev/client.js' ||
      url.pathname === '/api/multiplayer/dev/assembler.js'
    ) {
      if (!devEnabled(env)) return json({ ok: false, code: 'not-found' }, 404);
      const body =
        url.pathname === '/api/multiplayer/dev/client.js' ? devClientSource : assemblerClientSource;
      return new Response(body, {
        headers: {
          ...securityHeaders(),
          'Content-Type': 'text/javascript; charset=utf-8',
        },
      });
    }
    if (url.pathname === '/') {
      return html(
        '<!doctype html><meta charset="utf-8"><title>MCA multiplayer</title><p>MCA multiplayer staging runtime. See /api/multiplayer/health.</p>',
      );
    }

    const roomRoute = ROOM_ROUTE.exec(url.pathname);
    if (!roomRoute) return json({ ok: false, code: 'not-found' }, 404);

    // CORS preflight for the browser lobby. A disallowed origin gets no grant,
    // so the request fails at the browser instead of reaching a room action.
    if (request.method === 'OPTIONS') {
      const origin = corsOrigin(request, env);
      if (!origin) {
        return json({ ok: false, code: 'origin-rejected', message: 'Origin is not allowed.' }, 403);
      }
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    // A browser origin that is not allowlisted must not reach a room action at
    // all. A missing CORS grant only hides the reply; the request would still
    // create a room and spend a capacity slot. Requests with no Origin are
    // server-side callers (tooling, smoke tests) and keep working: a browser
    // cannot suppress the header.
    if (request.headers.get('Origin') !== null && !corsOrigin(request, env)) {
      return json({ ok: false, code: 'origin-rejected', message: 'Origin is not allowed.' }, 403);
    }
    if (!onlineEnabled(env)) {
      return json(
        { ok: false, code: 'online-disabled', message: 'Online multiplayer is disabled.' },
        503,
      );
    }
    const roomId = roomRoute[1];
    const action = roomRoute[2] ?? 'create';

    if (action === 'create' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'status' && request.method !== 'GET') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'shutdown' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'restart' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'snapshot' && request.method !== 'GET') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'start' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'join' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'open' && request.method !== 'POST') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }
    if (action === 'ws' && request.method !== 'GET') {
      return json({ ok: false, code: 'method-not-allowed' }, 405);
    }

    // Identity is verified at the edge, before a room action sees the request.
    // The Durable Object trusts only the header this code sets, and any
    // client-supplied copy of that header is always stripped.
    let effective = request;
    if (action === 'open' || action === 'join') {
      const identity = await withVerifiedIdentity(request, env.MCA_IDENTITY_TICKET_SECRET);
      if (!identity.ok) {
        return json({ ok: false, code: identity.code, message: identity.message }, identity.status);
      }
      effective = identity.request;
    }

    let response: Response;
    try {
      response = await forward(effective, env, roomId, action);
    } catch {
      response = json(
        { ok: false, code: 'room-unavailable', message: 'Room service is unavailable.' },
        503,
      );
    }
    // A socket upgrade is returned untouched: its response carries the accepted
    // WebSocket, and re-wrapping it would drop the connection.
    if (action === 'ws') return response;
    return withCors(request, env, response);
  },
};
