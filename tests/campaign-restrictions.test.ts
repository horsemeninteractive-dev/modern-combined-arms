import { describe, expect, it } from 'vitest';
import { scenarioById } from '../src/data/scenarioCatalog';
import { Game } from '../src/sim/game';
import { parseScenario } from '../src/sim/scenario';
import { researchNodeState } from '../src/ui/researchView';
import { TECHS } from '../src/data/research';
import { unitFamily } from '../src/data/units';
import { buildingFamily } from '../src/data/buildings';

/** Which canonical families a commander may actually field. */
function familiesOf(game: Game, owner = 0): Set<string> {
  return new Set(game.availableUnits(owner).map((id) => unitFamily(id)));
}

function gameFor(mapId: string): Game {
  const scenario = scenarioById(mapId)!.create();
  return new Game(scenario, { enableAI: false });
}

function inputFor(game: Game, owner = 0) {
  const player = game.state.players[owner];
  return {
    completed: game.completedTechnologies(owner),
    project: game.researchState(owner)?.project ?? null,
    mats: player.mats,
    req: player.req,
    hasCentre: true,
    allianceId: 'defender',
    factionId: player.factionId,
    restricted: game.operationLockedTechnologies(owner),
  };
}

describe('operation roster limits', () => {
  it('withholds the opening operation\u2019s armour, guns, aviation and fleet', () => {
    const game = gameFor('kestrel-beach');
    const families = familiesOf(game);
    // Tier-zero infantry and support remain.
    expect(families).toContain('rifle');
    expect(families).toContain('atgm');
    expect(families).toContain('engineer');
    // Nothing from the later branches.
    for (const withheld of ['tank', 'ifv', 'td', 'spg', 'rocketArtillery', 'uav', 'fighter', 'corvette']) {
      expect(families, withheld).not.toContain(withheld);
    }
    const buildings = game.availableBuildings(0);
    expect(buildings).toContain('barracks');
    expect(buildings).not.toContain('researchCentre');
    expect(buildings).not.toContain('airfield');
    expect(buildings).not.toContain('shipyard');
  });

  it('refuses the locked technologies to the command handler and the AI alike', () => {
    const game = gameFor('kestrel-beach');
    const eligibility = game.techEligibility(0, 'manoeuvre1');
    expect(eligibility.ok).toBe(false);
    expect(eligibility.reason).toContain('not available in this operation');
    for (const techId of Object.keys(TECHS)) {
      expect(game.techEligibility(0, techId).ok, techId).toBe(false);
    }
    expect(game.operationLockedTechnologies(0)).toEqual(Object.keys(TECHS));
  });

  it('presents a locked node as out of theatre, not merely unaffordable', () => {
    const game = gameFor('kestrel-beach');
    const view = researchNodeState(TECHS.manoeuvre1, inputFor(game));
    expect(view.status).toBe('mission');
    expect(view.canStart).toBe(false);
    expect(view.label).toBe('OUT OF THEATRE');
  });

  it('allows an unlocked node once the operation issues it', () => {
    // Rust Pass is fought with armour doctrine already issued.
    const game = gameFor('rust-pass');
    expect(game.completedTechnologies(0)).toContain('manoeuvre1');
    expect(familiesOf(game)).toContain('tank');
    expect(game.availableBuildings(0)).toContain('researchCentre');
    // But not the branches the operation still withholds.
    expect(game.techEligibility(0, 'air1').ok).toBe(false);
    expect(familiesOf(game)).not.toContain('spg');
  });

  it('leaves the finale with the whole roster', () => {
    const game = gameFor('straits-final');
    expect(game.operationLockedTechnologies(0)).toEqual([]);
    const families = familiesOf(game);
    for (const unit of ['tank', 'spg', 'fighter', 'corvette', 'frigate']) {
      expect(families, unit).toContain(unit);
    }
    // A national variant keeps its canonical family, so the yard and the
    // airfield are asserted by family rather than by platform id.
    const buildingFamilies = new Set(
      game.availableBuildings(0).map((id) => buildingFamily(id)),
    );
    expect(buildingFamilies).toContain('shipyard');
    expect(buildingFamilies).toContain('airfield');
  });

  it('does not change a scenario that authors no restrictions', () => {
    const scenario = scenarioById('island-assault')!.create();
    const game = new Game(scenario, { enableAI: false });
    expect(game.operationRestrictions(0)).toBeUndefined();
    expect(game.operationLockedTechnologies(0)).toEqual([]);
    expect(game.availableUnits(0).length).toBeGreaterThan(6);
  });

  it('survives a scenario round-trip without gaining or losing limits', () => {
    const scenario = scenarioById('lapland-watch')!.create();
    const parsed = parseScenario(JSON.parse(JSON.stringify(scenario)));
    expect(parsed.players[0].restrictions).toEqual(scenario.players[0].restrictions);
    expect(parsed.players[1].restrictions).toBeUndefined();
  });

  it('rejects a restriction list naming an unknown platform', () => {
    const scenario = scenarioById('kestrel-beach')!.create();
    const json = JSON.parse(JSON.stringify(scenario)) as Record<string, any>;
    json.players[0].restrictions.units.push('hovertank');
    expect(() => parseScenario(json)).toThrow(/restrictions\.units/);
  });
});
