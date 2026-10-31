/**
 * Dev-only cookie probe for the Pages-to-Worker WebSocket path. It proves that
 * a cookie set by the Pages origin is present on the upgrade request without
 * introducing production session logic.
 */
export async function onRequest(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': 'phase0_probe=1; Path=/; SameSite=Lax',
    },
  });
}
