import type { Game } from '../sim/game';
import { BUILDINGS } from '../data/buildings';
import { CAMPAIGNS } from '../data/campaign';
import { TUTORIAL_SCENARIO_ID } from '../data/tutorial';
import { tryIdentityDef } from '../data/factions';

/**
 * The primary objective and the live objective tally.
 *
 * The HUD used to print both in the command rail. They now live behind the
 * rail's objective button, but the mobile sheet and the desktop briefing must
 * read the same simulation state, so the wording is computed in one place.
 */

export function campaignMissionObjectives(game: Game): readonly string[] {
  const ref = game.state.scenario.meta.campaign;
  if (!ref) return [];
  const campaign = CAMPAIGNS.find((entry) => entry.id === ref.campaignId);
  return campaign?.missions.find((mission) => mission.id === ref.missionId)?.objectives ?? [];
}

export function primaryObjective(game: Game): string {
  if (game.state.scenario.meta.id === TUTORIAL_SCENARIO_ID) return 'Complete the training lanes.';
  // Campaign operations bring an authored first objective. Skirmish keeps the
  // dynamic command-post line below; only a campaign marker opts into the
  // operation brief, so an editor map's objective text is not commandeered.
  const campaignPrimary = campaignMissionObjectives(game)[0]?.trim();
  if (campaignPrimary) return campaignPrimary;
  const enemyHq = game.state.entities.find(
    (e) => e.owner !== game.localPlayerId && e.defId === 'commandPost' && e.hp > 0,
  );
  if (!enemyHq) return 'Enemy command destroyed — victory is yours.';
  if (game.state.scenario.settings.victory === 'annihilation') return 'Destroy all enemy forces.';
  // Name the actual opposing identity: a nation battle must not inherit the
  // map's legacy callsign in the objective line.
  const enemy = game.player(enemyHq.owner);
  const label = enemy ? tryIdentityDef(enemy.factionId)?.name ?? 'enemy' : 'enemy';
  return `Destroy the ${label} Command Post.`;
}

export interface ObjectiveProgress {
  /** Campaign operation name, or the dynamic skirmish objective. */
  primary: string;
  /** Relays / depots / radar held, passive income and command-post state. */
  summary: string;
  /** True once the local command post has been destroyed. */
  commandPostLost: boolean;
}

export function objectiveProgress(game: Game): ObjectiveProgress {
  const playerId = game.localPlayerId;
  const live = game.state.entities.filter((e) => e.hp > 0);
  const objectives = live.filter((e) => e.kind === 'building' && !!BUILDINGS[e.defId]?.capturable);
  const relays = objectives.filter((e) => e.defId === 'relay');
  const depots = objectives.filter((e) => !!BUILDINGS[e.defId]?.matsPerSec);
  const stations = objectives.filter((e) => !!BUILDINGS[e.defId]?.scanRadius);
  const owned = (list: typeof objectives): number =>
    list.filter((e) => e.owner === playerId).length;
  const hq = live.find(
    (e) => e.owner === playerId && e.defId === 'commandPost',
  );
  const enemyHq = live.find(
    (e) => e.owner !== playerId && e.defId === 'commandPost',
  );

  const parts = [`Relays ${owned(relays)}/${relays.length}`];
  if (depots.length > 0) parts.push(`Depots ${owned(depots)}/${depots.length}`);
  if (stations.length > 0) parts.push(`Radar ${owned(stations)}/${stations.length}`);
  const passive = game.passiveMatsRate(playerId);
  if (passive > 0) parts.push(`+${passive.toFixed(2)} M/s`);
  if (!hq) parts.push('Command Post lost');
  else if (!enemyHq) parts.push('Enemy HQ destroyed');

  return {
    primary: primaryObjective(game),
    summary: parts.join(' · '),
    commandPostLost: !hq,
  };
}
