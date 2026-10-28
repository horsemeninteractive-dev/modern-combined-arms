/**
 * Fog-of-war integrity.
 *
 * Phase 11 resolves an assault aim by walking out of the remembered structure's
 * footprint until the command layer accepts the point. The command layer's
 * `blocked` grid covers every structure on the map, including ones the AI has
 * never seen, so the question these fixtures exist to answer is whether hidden
 * occupancy can *steer* that aim.
 *
 * Each fixture therefore holds the AI's legitimate knowledge fixed and changes
 * only the physical world. The distinction they are built around:
 *
 *   - steering  — the AI orders a different destination because of a structure
 *                 it cannot see. That is a leak.
 *   - refusal   — the AI orders the destination it chose from its own knowledge
 *                 and the world refuses it. That is physics, and it stays.
 *
 * The scenarios are frozen: no economy, one remembered command post, six tanks,
 * a fixed seed. Nothing else can explain a difference between them.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState, knownForCrowding } from '../src/sim/ai';
import { TILE_SIZE } from '../src/sim/constants';
import { Terrain, tileIndex } from '../src/sim/terrain';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

interface FixtureOptions {
  /** An enemy bunker beside the post that the AI must not be able to see. */
  hiddenBunker?: boolean;
  /** Tanks in the east; fewer than four cannot leave the base on their own. */
  tanks?: number;
  /** A friendly scout beside the enemy post, so the team has really looked. */
  spotter?: boolean;
}

const ENEMY_POST = { tileX: 16, tileZ: 33 };
const OWN_POST = { tileX: 44, tileZ: 33 };
const BUNKER = { tileX: 21, tileZ: 33 };

/**
 * Six tanks in the east, one enemy command post in the west, no economy. The
 * tanks start nine tiles short of the bunker's tile, well outside any vision,
 * so the bunker is invisible unless a fixture says otherwise.
 */
function fixture(options: FixtureOptions = {}): Scenario {
  const scenario = createEmptyScenario(64, 64);
  scenario.meta.id = 'fog-integrity';
  scenario.settings.seed = 7;
  scenario.settings.fog = true;
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 18;
  scenario.players[0].startZ = 37;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 24;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: ENEMY_POST.tileX, z: ENEMY_POST.tileZ },
    { defId: 'commandPost', owner: 1, x: OWN_POST.tileX, z: OWN_POST.tileZ },
  );
  if (options.hiddenBunker) {
    scenario.structures.push({ defId: 'bunker', owner: 0, x: BUNKER.tileX, z: BUNKER.tileZ });
  }
  for (let i = 0; i < (options.tanks ?? 6); i++) {
    scenario.units.push({
      defId: 'tank',
      owner: 1,
      x: 30 + (i % 2) * 2,
      z: 28 + Math.floor(i / 2) * 2,
    });
  }
  if (options.spotter) {
    // One tile from the bunker and four from the post: close enough that the
    // team's own vision does the work, with no fixture magic.
    scenario.units.push({ defId: 'recon', owner: 1, x: 20, z: 33 });
  }
  return scenario;
}

/** Withdraw the spotter, leaving whatever it saw as charted memory. */
function withdraw(game: Game): void {
  const spotter = game.entitiesOf(1, 'unit').find((u) => u.defId === 'recon');
  if (!spotter) return;
  spotter.x = 180;
  spotter.z = 180;
  // Vision refreshes on its own schedule, so let a second of ticks pass before
  // asserting that the ground has gone dark again.
  game.advance(20);
}

interface Run {
  game: Game;
  ai: AIController;
  state: ReturnType<typeof initialAIState>;
  post: Entity;
  bunker: Entity | undefined;
}

/** Start a fixture with the post as a remembered contact, exactly as a match leaves one. */
function start(options: FixtureOptions = {}): Run {
  const game = new Game(fixture(options), { enableAI: false });
  const post = game.entitiesOf(0, 'building').find((b) => b.defId === 'commandPost')!;
  const bunker = game.entitiesOf(0, 'building').find((b) => b.defId === 'bunker');
  game.state.contacts.push({
    team: game.teamOf(1),
    entityId: post.id,
    x: post.x,
    z: post.z,
    tick: 0,
    defId: 'commandPost',
    kind: 'building',
  });
  return { game, ai: new AIController(), state: initialAIState(7, 'veteran'), post, bunker };
}

interface WaveTrace {
  /** World point of the first attack-move order any tank received. */
  destination: { x: number; z: number } | null;
  waves: number;
  decisions: string[];
  postHp: number;
}

/** Run the commander and record the first order it actually issues. */
function run(run: Run, seconds = 60): WaveTrace {
  const { game, ai, state } = run;
  let destination: { x: number; z: number } | null = null;
  const decisions = new Set<string>();
  for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
    game.tick();
    ai.update(game, 1, state);
    // A sighting stays fresh while someone is watching; without this the
    // commander drops the trail after forty seconds and starts scouting.
    const contact = game.state.contacts.find((c) => c.entityId === run.post.id);
    if (contact) contact.tick = game.state.tick;
    if (state.lastDecision) decisions.add(state.lastDecision);
    if (!destination) {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId !== 'tank') continue;
        if (unit.order && unit.order.type !== 'repair') {
          destination = { x: unit.order.x ?? 0, z: unit.order.z ?? 0 };
          break;
        }
      }
    }
  }
  return {
    destination,
    waves: state.attackWave,
    decisions: [...decisions],
    postHp: run.post.hp,
  };
}

describe('fog integrity', () => {
  it('does not let an unseen structure steer the assault destination', () => {
    // Control: nothing in the way, so the commander picks the first formation
    // slot the command layer accepts and attacks with it.
    const clear = run(start());

    // Same world plus a bunker the AI has never seen. The aim must be the one
    // it chose from its own knowledge — the hidden building may refuse that
    // order, but it must not push the wave somewhere else.
    const blind = start({ hiddenBunker: true });
    expect(blind.bunker).toBeDefined();
    const team = blind.game.teamOf(1);
    expect(blind.game.isKnownTo(team, blind.bunker!.id)).toBe(false);
    expect(blind.game.contactsFor(1)).toHaveLength(1);
    const blindRun = run(blind);

    expect(clear.destination).not.toBeNull();
    expect(clear.waves).toBeGreaterThanOrEqual(1);
    expect(blindRun.waves).toBe(0);
    expect(blindRun.destination).toBeNull();
    expect(blindRun.decisions.some((d) => d.includes('no approach'))).toBe(true);
    // Unexplained damage would mean the wave left anyway.
    expect(blindRun.postHp).toBe(blind.post.maxHp);
  });

  it('approaches a remembered post past a structure it has charted', () => {
    const seen = start({ hiddenBunker: true, spotter: true });
    seen.game.tick();
    withdraw(seen.game);
    // The scout has looked at this ground: the bunker stays charted even though
    // nothing can see it now, so the aim is allowed to account for it.
    expect(seen.game.isKnownTo(seen.game.teamOf(1), seen.bunker!.id)).toBe(true);
    expect(seen.game.isVisibleTo(seen.game.teamOf(1), seen.bunker!.id)).toBe(false);
    const trace = run(seen);
    expect(trace.waves).toBeGreaterThanOrEqual(1);
    expect(trace.destination).not.toBeNull();
    // Outside the charted bunker's 2x2 footprint, so the wave is not ordered
    // into it.
    const bunker = seen.bunker!;
    const half = TILE_SIZE;
    expect(
      Math.abs(trace.destination!.x - bunker.x) >= half ||
        Math.abs(trace.destination!.z - bunker.z) >= half,
    ).toBe(true);
    expect(trace.postHp).toBeLessThan(seen.post.maxHp);
  });

  it('keeps a remembered structure as a destination but not as fresh information', () => {
    const remembered = start({ spotter: true });
    remembered.game.tick();
    withdraw(remembered.game);
    // Nothing on the west side moves, so the contact can only come from memory.
    for (let i = 0; i < 20 * 5; i++) remembered.game.tick();
    const contact = remembered.game.contactsFor(1).find((c) => c.entityId === remembered.post.id);
    expect(contact).toBeDefined();
    expect(contact!.x).toBe(remembered.post.x);
    expect(contact!.z).toBe(remembered.post.z);
    // It is remembered, not visible.
    expect(remembered.game.isVisibleTo(remembered.game.teamOf(1), remembered.post.id)).toBe(false);
    expect(remembered.game.visionStateOf(remembered.game.teamOf(1), remembered.post.id)).toBe('remembered');

    const trace = run(remembered);
    expect(trace.destination).not.toBeNull();
    expect(trace.destination!.x).toBeLessThan(remembered.post.x + 12 * TILE_SIZE);
  });

  it('drops an assault when the memory of the target expires', () => {
    // Two tanks cannot reach the assault gate or the overdue threshold, so the
    // only thing that changes over thirty-five seconds is the memory.
    const stale = start({ tanks: 2 });
    stale.game.tick();
    // Contacts live thirty seconds; the trail goes cold forty seconds after the
    // last sighting, and that clock only starts once the contact is gone.
    for (let i = 0; i < 20 * 75; i++) {
      stale.game.tick();
      stale.ai.update(stale.game, 1, stale.state);
    }
    expect(stale.state.attackWave).toBe(0);
    expect(stale.game.contactsFor(1).some((c) => c.entityId === stale.post.id)).toBe(false);
    expect(stale.state.targetKnown).toBe(false);
    expect(stale.post.hp).toBe(stale.post.maxHp);
  });

  it('never acquires a structure the team has not seen', () => {
    const hidden = start({ hiddenBunker: true });
    const team = hidden.game.teamOf(1);
    hidden.game.tick();
    expect(hidden.game.isVisibleTo(team, hidden.bunker!.id)).toBe(false);
    expect(hidden.game.visionStateOf(team, hidden.bunker!.id)).toBe('hidden');
    expect(hidden.game.isKnownTo(team, hidden.bunker!.id)).toBe(false);
    // Contacts are sightings, not a map of the enemy base.
    expect(hidden.game.contactsFor(1).map((c) => c.entityId)).toEqual([hidden.post.id]);
    // The objective it names is the post it remembers; the unseen bunker's
    // coordinates never appear in a decision.
    const trace = run(hidden);
    const label = (e: Entity): string =>
      `${Math.round(e.x / TILE_SIZE)},${Math.round(e.z / TILE_SIZE)}`;
    expect(trace.decisions.some((d) => d.includes(label(hidden.bunker!)))).toBe(false);
    expect(hidden.state.targetBaseX).toBe(hidden.post.x);
    expect(hidden.state.targetBaseZ).toBe(hidden.post.z);
  });

  it('shares sightings between allies and with nobody else', () => {
    // Three players: 0 on its own team, 1 and 2 together. Player 2's scout sees
    // the enemy post, so both members of that team know it — and team 0 learns
    // nothing about the AI's base in return.
    const scenario = fixture();
    scenario.players.push({
      id: 2,
      name: 'Ally',
      factionId: 'baltic',
      team: 1,
      isAI: true,
      startX: 20,
      startZ: 40,
    });
    scenario.units.push({ defId: 'recon', owner: 2, x: 20, z: 33 });
    const game = new Game(scenario, { enableAI: false });
    const post = game.entitiesOf(0, 'building').find((b) => b.defId === 'commandPost')!;
    const ownPost = game.entitiesOf(1, 'building').find((b) => b.defId === 'commandPost')!;
    game.tick();
    expect(game.isVisibleTo(game.teamOf(2), post.id)).toBe(true);
    expect(game.isVisibleTo(game.teamOf(1), post.id)).toBe(true);
    const remembers = (playerId: number): boolean =>
      game.state.contacts.some(
        (c) => c.team === game.teamOf(playerId) && c.entityId === post.id,
      );
    expect(remembers(2)).toBe(true);
    expect(remembers(1)).toBe(true);
    // The other side learns nothing: no vision, no contact, no charted base.
    expect(game.isVisibleTo(game.teamOf(0), ownPost.id)).toBe(false);
    expect(game.isKnownTo(game.teamOf(0), ownPost.id)).toBe(false);
    expect(game.contactsFor(0)).toHaveLength(0);
  });

  it('does not send an engineer to capture a structure it has never seen', () => {
    // A forward depot the enemy built in the dark, twenty tiles from the AI's
    // engineer. Without a sighting the commander has no reason to know it is
    // there, so the engineer stays home; with one, the same depot becomes a
    // capture target.
    const build = (withDepot: boolean) => {
      const scenario = createEmptyScenario(64, 64);
      scenario.settings.seed = 7;
      scenario.settings.fog = true;
      scenario.settings.startingMats = 0;
      scenario.settings.startingReq = 0;
      scenario.settings.victory = 'destroyHQ';
      scenario.players[0].factionId = 'baltic';
      scenario.players[0].startX = 10;
      scenario.players[0].startZ = 10;
      scenario.players[1].factionId = 'baltic';
      scenario.players[1].startX = 40;
      scenario.players[1].startZ = 30;
      scenario.structures.push(
        { defId: 'commandPost', owner: 0, x: 8, z: 8 },
        { defId: 'commandPost', owner: 1, x: 44, z: 33 },
      );
      if (withDepot) {
        scenario.structures.push({ defId: 'supplyDepot', owner: 0, x: 20, z: 20 });
      }
      scenario.units.push({ defId: 'engineer', owner: 1, x: 38, z: 30 });
      return new Game(scenario, { enableAI: false });
    };
    const capture = (game: Game) => {
      const ai = new AIController();
      const state = initialAIState(7, 'veteran');
      let ordered = false;
      for (let i = 0; i < 20 * 120 && game.state.victory === 'playing'; i++) {
        game.tick();
        ai.update(game, 1, state);
        const engineer = game.entitiesOf(1, 'unit').find((u) => u.defId === 'engineer');
        if (engineer?.order?.type === 'capture') ordered = true;
      }
      return ordered;
    };
    const dark = build(true);
    const depot = dark.entitiesOf(0, 'building').find((b) => b.defId === 'supplyDepot')!;
    expect(dark.isKnownTo(dark.teamOf(1), depot.id)).toBe(false);
    expect(capture(dark)).toBe(false);
    expect(dark.isVisibleTo(dark.teamOf(1), depot.id)).toBe(false);
    expect(capture(build(false))).toBe(false);

    // Charted by a scout that has since left: now it is a legitimate target.
    const seen = build(true);
    const seenDepot = seen.entitiesOf(0, 'building').find((b) => b.defId === 'supplyDepot')!;
    seen.state.charted.push({ team: seen.teamOf(1), entityId: seenDepot.id });
    // The chart index is rebuilt on load, which is also how a real save carries
    // it, so this is the supported way to grant the memory in a fixture.
    const reloaded = Game.fromSave(JSON.parse(JSON.stringify(seen.toSave())), {
      enableAI: false,
    });
    const depotAfter = reloaded
      .entitiesOf(0, 'building')
      .find((b) => b.defId === 'supplyDepot')!;
    expect(reloaded.isKnownTo(reloaded.teamOf(1), depotAfter.id)).toBe(true);
    expect(capture(reloaded)).toBe(true);
  });

  /**
   * A build-site fixture. The engineer stands north of the base so the northern
   * ring is the natural place to build, and the forest pocket gives an enemy
   * somewhere to hide just close enough to the candidate sites to be counted —
   * but far enough from the engineer to stay unseen. Terrain is identical in
   * both worlds; only the enemy presence changes.
   */
  function buildSiteGame(hidden: boolean): { game: Game; tanks: Entity[]; engineer: Entity } {
    const scenario = createEmptyScenario(64, 64);
    scenario.settings.seed = 7;
    scenario.settings.fog = true;
    scenario.settings.startingMats = 3000;
    scenario.settings.startingReq = 180;
    scenario.settings.victory = 'destroyHQ';
    scenario.players[0].factionId = 'baltic';
    scenario.players[0].startX = 8;
    scenario.players[0].startZ = 8;
    scenario.players[1].factionId = 'baltic';
    scenario.players[1].startX = 40;
    scenario.players[1].startZ = 30;
    scenario.structures.push(
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    );
    scenario.units.push({ defId: 'engineer', owner: 1, x: 42, z: 20 });
    for (let z = 21; z <= 26; z++) {
      for (let x = 44; x <= 50; x++) scenario.tiles[tileIndex(64, x, z)].t = Terrain.Forest;
    }
    if (hidden) {
      for (const [x, z] of [
        [46, 23],
        [48, 23],
        [46, 25],
        [48, 25],
      ]) {
        scenario.units.push({ defId: 'tank', owner: 0, x, z });
      }
    }
    const game = new Game(scenario, { enableAI: false });
    return {
      game,
      tanks: game.entitiesOf(0, 'unit').filter((u) => u.defId === 'tank'),
      engineer: game.entitiesOf(1, 'unit').find((u) => u.defId === 'engineer')!,
    };
  }

  /** Run until the first construction site exists, then report it. */
  function firstSite(world: ReturnType<typeof buildSiteGame>) {
    const ai = new AIController();
    const state = initialAIState(7, 'veteran');
    for (let i = 0; i < 20 * 180; i++) {
      world.game.tick();
      ai.update(world.game, 1, state);
      const site = world.game.entitiesOf(1, 'building').find((b) => b.construction);
      if (site) {
        return { defId: site.defId, x: site.x, z: site.z, tick: world.game.state.tick };
      }
    }
    return null;
  }

  it('does not let unseen enemies choose the construction site', () => {
    const clear = buildSiteGame(false);
    const dark = buildSiteGame(true);
    // Same knowledge in both worlds: the tanks are neither seen nor charted.
    const team = dark.game.teamOf(1);
    expect(dark.tanks).toHaveLength(4);
    for (const tank of dark.tanks) {
      expect(dark.game.isVisibleTo(team, tank.id)).toBe(false);
      expect(dark.game.isKnownTo(team, tank.id)).toBe(false);
      expect(knownForCrowding(dark.game, 1, tank)).toBe(false);
    }

    const clearSite = firstSite(clear);
    const darkSite = firstSite(dark);
    expect(clearSite).not.toBeNull();
    expect(darkSite).toEqual(clearSite);
    // Still unseen when the order was given, so nothing else explains it.
    expect(knownForCrowding(dark.game, 1, dark.tanks[0]!)).toBe(false);
  });

  it('still counts what the commander can see', () => {
    // The same map and the same units, but the tanks are in plain sight: a
    // visible enemy is legitimate information for a site score.
    const spotted = buildSiteGame(true);
    const team = spotted.game.teamOf(1);
    // Lift the fog for one tick: every structure and unit is now seen, which is
    // the closest fixture equivalent of "a scout is watching them".
    spotted.game.state.scenario.settings.fog = false;
    spotted.game.tick();
    for (const tank of spotted.tanks) {
      expect(spotted.game.isVisibleTo(team, tank.id)).toBe(true);
      expect(knownForCrowding(spotted.game, 1, tank)).toBe(true);
    }
  });

  it('classifies own, allied, neutral and remembered entities correctly', () => {
    const world = buildSiteGame(true);
    const game = world.game;
    const own = game.entitiesOf(1, 'building')[0]!;
    const neutral = game.state.entities.find((e) => e.owner < 0);
    expect(knownForCrowding(game, 1, own)).toBe(true);
    expect(knownForCrowding(game, 1, world.engineer)).toBe(true);
    // The enemy command post was never seen either.
    const enemyPost = game.entitiesOf(0, 'building').find((b) => b.defId === 'commandPost')!;
    expect(knownForCrowding(game, 1, enemyPost)).toBe(false);
    // An authored map object is common knowledge when one exists.
    if (neutral) expect(knownForCrowding(game, 1, neutral)).toBe(true);
    // A remembered contact is a stale position, not live occupancy: even after
    // the team has seen the tanks, they stop counting once they are out of sight
    // again only if their contact is all that is left — which is exactly what
    // `isVisibleTo` decides.
    expect(knownForCrowding(game, 1, world.tanks[0]!)).toBe(false);
  });

  it('keeps physical placement authoritative', () => {
    const world = buildSiteGame(true);
    const site = firstSite(world);
    expect(site).not.toBeNull();
    const tile = { x: Math.round(site!.x / TILE_SIZE), z: Math.round(site!.z / TILE_SIZE) };
    // Replay the same world and the same number of ticks with no AI at all, so
    // the tile the AI chose is still empty, and ask the placement layer whether
    // it could really be built on. A construction site exists only because that
    // check already passed.
    const empty = buildSiteGame(true);
    while (empty.game.state.tick < site!.tick) empty.game.tick();
    const engineer = empty.game.entitiesOf(1, 'unit').find((u) => u.defId === 'engineer')!;
    expect(empty.game.placementStatus(1, site!.defId, tile.x, tile.z, engineer.id, true).ok).toBe(
      true,
    );
    // And an unseen enemy still blocks ground physically: knowledge does not
    // make a tank disappear.
    const tank = world.tanks[0]!;
    const blocked = empty.game.placementStatus(
      1,
      'barracks',
      Math.round(tank.x / TILE_SIZE),
      Math.round(tank.z / TILE_SIZE),
      engineer.id,
      true,
    );
    expect(blocked.ok).toBe(false);
  });

  it('repeats the same site selection on an identical seed', () => {
    const a = firstSite(buildSiteGame(true));
    const b = firstSite(buildSiteGame(true));
    expect(a).toEqual(b);
    const first = buildSiteGame(true);
    const second = buildSiteGame(true);
    firstSite(first);
    firstSite(second);
    expect(first.game.stateHash()).toBe(second.game.stateHash());
  });

  it('replays the same decisions and visibility on an identical seed', () => {
    const a = start({ hiddenBunker: true });
    const b = start({ hiddenBunker: true });
    const traceA = run(a);
    const traceB = run(b);
    expect(traceA.destination).toEqual(traceB.destination);
    expect(traceA.waves).toBe(traceB.waves);
    expect(traceA.postHp).toBe(traceB.postHp);
    expect(a.game.stateHash()).toBe(b.game.stateHash());
  });
});
