import { AIController, initialAIState } from '../sim/ai';
import { Game } from '../sim/game';
import { TICK_RATE } from '../sim/constants';
import type { Scenario } from '../sim/scenario';
import type { AIControlState, AIDifficulty } from '../sim/types';

export interface MenuAttractOptions {
  /** Deterministic seed pair for the two commanders. */
  seed?: number;
  /** Seconds of battle already fought before the first frame is shown. */
  warmupTicks?: number;
  difficulties?: [AIDifficulty, AIDifficulty];
}

/**
 * A presentation-only AI-vs-AI battle for the menu backdrop. It owns a normal
 * Game with a spectator local player and two explicit commanders; it never
 * writes saves, draws a HUD or emits audio. The menu can throw it away at any
 * time when the player leaves the deck.
 */
export class MenuAttractMatch {
  readonly game: Game;
  private readonly commanders: Array<{
    id: number;
    controller: AIController;
    state: AIControlState;
  }> = [];
  private accumulator = 0;

  constructor(scenario: Scenario, options: MenuAttractOptions = {}) {
    // Both slots are AI. The map's authored colours and nation ids stay, but
    // both commanders now play by the same rules as a skirmish opponent.
    for (const player of scenario.players) player.isAI = true;
    scenario.settings.fog = false;
    this.game = new Game(scenario, { enableAI: false, localPlayerId: -1 });

    const seed = (options.seed ?? scenario.settings.seed) >>> 0;
    const difficulties = options.difficulties ?? (['veteran', 'elite'] as const);
    for (let i = 0; i < this.game.state.players.length; i++) {
      const id = this.game.state.players[i].id;
      this.commanders.push({
        id,
        controller: new AIController(),
        state: initialAIState((seed + i * 0x9e3779b9) >>> 0, difficulties[i] ?? 'veteran'),
      });
    }

    // The menu should open on a battle already in progress, not on two empty
    // staging areas. A short deterministic warm-up is cheap and keeps the
    // backdrop alive immediately.
    const warmup = Math.max(0, Math.min(4000, options.warmupTicks ?? 0));
    for (let i = 0; i < warmup; i++) this.step();
  }

  /** Advance at the normal simulation rate, capped so a stalled tab cannot spiral. */
  update(dt: number): void {
    this.accumulator += Math.min(0.1, Math.max(0, dt));
    let steps = 0;
    while (this.accumulator >= 1 / TICK_RATE && steps < 4) {
      this.step();
      this.accumulator -= 1 / TICK_RATE;
      steps++;
    }
  }

  /** One simulation step, used for the menu's time-budgeted warm-up. */
  stepOnce(): void {
    for (const commander of this.commanders) {
      commander.controller.update(this.game, commander.id, commander.state);
    }
    this.game.tick();
  }

  private step(): void {
    this.stepOnce();
  }
}
