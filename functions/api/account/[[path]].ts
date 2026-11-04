/**
 * Pages proxy for the account service.
 *
 * The player's origin is Pages, so the account API is served from Pages too and
 * forwarded to the account Worker through a service binding. That keeps the
 * session cookie first-party (no `SameSite=None`, no third-party cookie policy
 * roulette) and avoids CORS entirely.
 *
 * The request is forwarded untouched: method, headers, Cookie, Origin, body and
 * query string all reach the Worker unchanged, and the Worker's response —
 * including its `Set-Cookie` — is returned as-is. Every security decision stays
 * in the Worker, so there is exactly one implementation of it.
 */
interface AccountProxyEnv {
  MCA_ACCOUNT?: {
    fetch(request: Request): Promise<Response>;
  };
}

interface AccountProxyContext {
  request: Request;
  env: AccountProxyEnv;
}

export async function onRequest(context: AccountProxyContext): Promise<Response> {
  if (!context.env.MCA_ACCOUNT) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'server-error',
          message: 'Accounts are not configured on this deployment. Guest play is unaffected.',
        },
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      },
    );
  }
  return context.env.MCA_ACCOUNT.fetch(context.request);
}
