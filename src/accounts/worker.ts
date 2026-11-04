/**
 * Cloudflare Worker entry for the account service.
 *
 * The Worker owns exactly three things: the D1 binding, the deployment
 * configuration and the fetch callable. All rules are in `router.ts`, so this
 * file stays small enough to review at a glance.
 */
import { resolveConfig, type AccountEnv } from './config';
import { D1AccountStore, type D1DatabaseLike } from './d1Store';
import { handleAccountRequest, jsonResponse } from './router';

export default {
  async fetch(request: Request, env: AccountEnv): Promise<Response> {
    if (!env.DB) {
      return jsonResponse(
        { ok: false, error: { code: 'server-error', message: 'Account storage is not configured.' } },
        503,
      );
    }
    const config = resolveConfig(env);
    return handleAccountRequest(request, {
      store: new D1AccountStore(env.DB as D1DatabaseLike),
      config,
      fetch: (input, init) => fetch(input, init),
    });
  },
};

export { handleAccountRequest } from './router';
export { verifyTicket, issueTicket } from './tickets';
