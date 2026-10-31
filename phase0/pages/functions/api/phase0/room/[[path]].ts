/**
 * Pages Function WebSocket proxy probe.
 *
 * The function is deliberately a pure forwarder: it does not rebuild the
 * request, so the Upgrade, Cookie, Origin, query string and subprotocol headers
 * reach the room Worker unchanged. The Worker then forwards to the Durable
 * Object. This is the path the production lobby would use only after the
 * phase-0 gate passes.
 */
interface Phase0PagesEnv {
  PHASE0_ROOM: {
    fetch(request: Request): Promise<Response>;
  };
}

interface Phase0PagesContext {
  request: Request;
  env: Phase0PagesEnv;
}

export async function onRequest(context: Phase0PagesContext): Promise<Response> {
  return context.env.PHASE0_ROOM.fetch(context.request);
}
