import { TICK_RATE } from '../sim/constants';
import type { Game } from '../sim/game';

/**
 * The room's result is team-based, not local-player-based.
 *
 * `Game.evaluateVictory()` answers "did the human commander win this
 * single-player battle". A 2v2 room cannot use that answer: one player's
 * defeat must not end the match for their ally, and every seat must receive
 * the same winner. The room stops when this function says the match is over.
 */

export interface TeamMatchState {
  team: number;
  playerIds: number[];
  defeated: boolean;
  /** Remaining hit points across living team entities; used only at the time limit. */
  score: number;
}

export type MatchEndReason = 'elimination' | 'time-limit' | 'draw' | 'abandoned';

export interface NeutralMatchResult {
  phase: 'playing' | 'finished';
  winnerTeam: number | null;
  reason: MatchEndReason | null;
  teams: TeamMatchState[];
  tick: number;
}

export interface MatchResultOptions {
  /** Teams whose seats have all surrendered, disconnected permanently or been removed. */
  abandonedTeams?: readonly number[];
  /**
   * The room's reservation deadline is authoritative even if timer throttling
   * left the simulation short of the scenario's own time limit.
   */
  forceTimeLimit?: boolean;
}

/** Result from one team's point of view; safe to send to every seat. */
export function resultForTeam(
  result: NeutralMatchResult,
  team: number,
): 'playing' | 'victory' | 'defeat' | 'draw' {
  if (result.phase === 'playing') return 'playing';
  if (result.winnerTeam === null) return 'draw';
  return result.winnerTeam === team ? 'victory' : 'defeat';
}

/**
 * Compute the authoritative neutral result from player/team state.
 *
 * The caller may pass `abandonedTeams` after the room has exhausted its
 * reconnect grace. This does not mutate `game.state.victory`; single-player
 * continues to use its existing local-player presentation unchanged.
 */
export function evaluateMatchResult(
  game: Game,
  options: MatchResultOptions = {},
): NeutralMatchResult {
  const players = game.state.players;
  if (players.length === 0) throw new Error('Cannot evaluate a match with no players.');

  const teams = [...new Set(players.map((player) => player.team))].sort((a, b) => a - b);
  const abandoned = new Set(options.abandonedTeams ?? []);
  const teamStates: TeamMatchState[] = teams.map((team) => {
    const members = players.filter((player) => player.team === team);
    return {
      team,
      playerIds: members.map((player) => player.id),
      defeated:
        abandoned.has(team) || members.every((player) => player.defeated),
      score: game.state.entities
        .filter((entity) => entity.hp > 0 && game.teamOf(entity.owner) === team)
        .reduce((sum, entity) => sum + entity.hp, 0),
    };
  });

  const alive = teamStates.filter((state) => !state.defeated);
  if (alive.length === 1) {
    return {
      phase: 'finished',
      winnerTeam: alive[0].team,
      reason: abandoned.size > 0 ? 'abandoned' : 'elimination',
      teams: teamStates,
      tick: game.state.tick,
    };
  }
  if (alive.length === 0) {
    return {
      phase: 'finished',
      winnerTeam: null,
      reason: 'draw',
      teams: teamStates,
      tick: game.state.tick,
    };
  }

  const limit = game.state.scenario.settings.timeLimitSec;
  if (limit !== null || options.forceTimeLimit === true) {
    const elapsed = (game.state.tick - game.state.startedAtTick) / TICK_RATE;
    if (options.forceTimeLimit === true || elapsed >= (limit as number)) {
      const best = Math.max(...teamStates.map((state) => state.score));
      const leaders = teamStates.filter((state) => state.score === best);
      return {
        phase: 'finished',
        winnerTeam: leaders.length === 1 ? leaders[0].team : null,
        reason: leaders.length === 1 ? 'time-limit' : 'draw',
        teams: teamStates,
        tick: game.state.tick,
      };
    }
  }

  return {
    phase: 'playing',
    winnerTeam: null,
    reason: null,
    teams: teamStates,
    tick: game.state.tick,
  };
}
