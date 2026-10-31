import { Phase0Room } from './room.mjs';

export { Phase0Room };

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ROOM_ROUTE = /^\/api\/phase0\/room\/([A-Za-z0-9_-]{1,64})\/(ws|stats|shutdown|health)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/phase0/health') {
      return json({ ok: true, service: 'mca-phase0-rooms', version: 1 });
    }
    const match = ROOM_ROUTE.exec(url.pathname);
    if (!match) return json({ error: 'not-found' }, 404);
    const [, roomId] = match;
    const id = env.PHASE0_ROOM.idFromName(roomId);
    return env.PHASE0_ROOM.get(id).fetch(request);
  },
};
