/**
 * Online play feature state.
 *
 * `enabled` is a statement about *production hosting*: the live build now ships
 * a room worker address (`.env.production`) and a deployed room worker that
 * allowlists the Pages origin, so public online play is on. The flags beside it
 * stay off on purpose — there is no room list to browse and no account system,
 * so a player reaches a match by sharing a room code and a join code.
 */
export const MULTIPLAYER_FEATURE = Object.freeze({
  enabled: true,
  roomDiscovery: false,
  accountLinking: false,
  reason: 'Online 1v1 ships through the deployed room worker; rooms are joined by code.',
});
