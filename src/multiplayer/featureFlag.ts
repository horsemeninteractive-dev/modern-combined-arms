/**
 * Online play feature state.
 *
 * `enabled` is a statement about *production hosting*: the live build ships a
 * room worker address (`.env.production`) and a deployed room worker that
 * allowlists the Pages origin, so public online play is on.
 *
 * `roomDiscovery` stays off because there is no room list to browse: a room is
 * addressed by the code the host shares, and the lobby shows seat, nation and
 * colour rather than a player directory.
 *
 * `accountLinking` stays off because a room seat is still authorised by its own
 * bearer token. Accounts exist — the account Worker holds the career record and
 * the room Worker verifies an account ticket when one is presented — but a seat
 * is not tied to an account, so an anonymous guest and a signed-in player take a
 * seat the same way, and no career result is written from a room yet.
 */
export const MULTIPLAYER_FEATURE = Object.freeze({
  enabled: true,
  roomDiscovery: false,
  accountLinking: false,
  reason: 'Online 1v1 ships through the deployed room worker; rooms are joined by code.',
});
