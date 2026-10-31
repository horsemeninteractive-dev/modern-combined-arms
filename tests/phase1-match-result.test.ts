import { evaluateMatchResult, resultForTeam } from '../src/multiplayer/matchResult';
import { serverGame, twoVersusTwoGame } from './phase1-helpers';

describe('Phase 1 neutral match results', () => {
  it('derives a 1v1 winner from team state, not local player state', () => {
    const game = serverGame();
    game.player(0)!.defeated = true;
    const result = evaluateMatchResult(game);
    expect(result).toMatchObject({
      phase: 'finished',
      winnerTeam: 1,
      reason: 'elimination',
    });
    expect(resultForTeam(result, 0)).toBe('defeat');
    expect(resultForTeam(result, 1)).toBe('victory');
  });

  it('does not end a 2v2 team when one ally is defeated', () => {
    const game = twoVersusTwoGame();
    game.player(0)!.defeated = true;
    expect(evaluateMatchResult(game).phase).toBe('playing');

    game.player(2)!.defeated = true;
    const result = evaluateMatchResult(game);
    expect(result).toMatchObject({
      phase: 'finished',
      winnerTeam: 1,
      reason: 'elimination',
    });
    expect(resultForTeam(result, 0)).toBe('defeat');
    expect(resultForTeam(result, 1)).toBe('victory');
  });

  it('supports the other 2v2 team winning', () => {
    const game = twoVersusTwoGame();
    game.player(1)!.defeated = true;
    game.player(3)!.defeated = true;
    const result = evaluateMatchResult(game);
    expect(result).toMatchObject({ phase: 'finished', winnerTeam: 0 });
  });

  it('reports a draw when every team is defeated', () => {
    const game = serverGame();
    game.player(0)!.defeated = true;
    game.player(1)!.defeated = true;
    const result = evaluateMatchResult(game);
    expect(result).toMatchObject({ phase: 'finished', winnerTeam: null, reason: 'draw' });
    expect(resultForTeam(result, 0)).toBe('draw');
  });

  it('turns an abandoned team into a loss', () => {
    const game = serverGame();
    const result = evaluateMatchResult(game, { abandonedTeams: [0] });
    expect(result).toMatchObject({
      phase: 'finished',
      winnerTeam: 1,
      reason: 'abandoned',
    });
  });

  it('uses team hit points only when the scenario time limit expires', () => {
    const game = serverGame();
    game.state.scenario.settings.timeLimitSec = 1;
    game.state.tick = 20;
    for (const entity of game.state.entities) {
      if (game.teamOf(entity.owner) === 1) entity.hp = 0;
    }
    const result = evaluateMatchResult(game);
    expect(result).toMatchObject({
      phase: 'finished',
      winnerTeam: 0,
      reason: 'time-limit',
    });
  });
});
