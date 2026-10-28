/**
 * Army-collapse fixtures.
 *
 * Phase 10 found that a timeout can end with a surviving force parked a dozen
 * tiles from a defenceless command post, never attacking it. These fixtures
 * isolate the decision that produces that state: the AI's assault gate.
 *
 * Every fixture is deterministic, has no ore and no bank, so no production is
 * possible and the only question is what the commander does with the force it
 * already has. The enemy base is not visible; it is a remembered contact, which
 * is what a real match leaves behind after the first engagement.
 *
 * Phase 11 extends them with the last-ditch question: a commander whose economy
 * is exhausted still has to decide whether the force it holds is worth spending.
 * The same fixtures therefore run with an empty bank, with an adequate bank and
 * no producer, with normal arena ore, against defenders, and against an
 * engineer repairing the post.
 *
 *   npx tsx tools/collapse-fixtures.ts [seconds=120] [orePerTile=0]
 *
 * Set MCA_AI_APPROACH=off to run the same fixtures with the pre-Phase-11 aim.
 * It changes no game behaviour. It prints one JSON line per fixture and a
 * summary that states the smallest force the commander will commit.
 */
import { Game } from '../src/sim/game';
import { AIController, initialAIState } from '../src/sim/ai';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { dist } from '../src/core/math';
import type { Entity } from '../src/sim/types';

const args = process.argv.slice(2);
const seconds = Math.max(30, Math.min(600, Number(args[0] ?? 120)));
/** Materials per authored ore tile around each base; 0 keeps the map barren. */
const orePerTile = Math.max(0, Math.min(5000, Number(args[1] ?? 0)));
const resolveApproach = (process.env.MCA_AI_APPROACH ?? 'on') !== 'off';

interface FixtureSpec {
  name: string;
  tanks: number;
  /** Enemy static defence at its command post. */
  turrets: number;
  /** Defending enemy tanks, to test whether committing would be suicide. */
  defenders: number;
  /** Bank at the start: proves a rich commander cannot buy a way out. */
  mats?: number;
  /** An enemy engineer standing on its own post, repairing it. */
  repairEngineer?: boolean;
  /** Fraction of the enemy post's health already gone. */
  postDamage?: number;
  /** Give the commander a working base, so production can lift its army. */
  base?: boolean;
}

const FIXTURES: FixtureSpec[] = [
  { name: '1 tank, undefended post', tanks: 1, turrets: 0, defenders: 0 },
  { name: '2 tanks, undefended post', tanks: 2, turrets: 0, defenders: 0 },
  { name: '3 tanks, undefended post', tanks: 3, turrets: 0, defenders: 0 },
  { name: '4 tanks, undefended post', tanks: 4, turrets: 0, defenders: 0 },
  { name: '6 tanks, undefended post', tanks: 6, turrets: 0, defenders: 0 },
  { name: '4 tanks, 3000 bank', tanks: 4, turrets: 0, defenders: 0, mats: 3000 },
  { name: '1 tank, two AT turrets', tanks: 1, turrets: 2, defenders: 0 },
  { name: '3 tanks, two AT turrets', tanks: 3, turrets: 2, defenders: 0 },
  { name: '4 tanks, two AT turrets', tanks: 4, turrets: 2, defenders: 0 },
  { name: '3 tanks, one defending tank', tanks: 3, turrets: 0, defenders: 1 },
  { name: '4 tanks, one defending tank', tanks: 4, turrets: 0, defenders: 1 },
  { name: '3 tanks, post under repair', tanks: 3, turrets: 0, defenders: 0, repairEngineer: true, postDamage: 0.4 },
  { name: '4 tanks, post under repair', tanks: 4, turrets: 0, defenders: 0, repairEngineer: true, postDamage: 0.4 },
  // A healthy base is the control for "does the small-force commit bypass the
  // ordinary massing gate?". Production can lift the army here, so a commander
  // that still leaves with two tanks would be attacking regardless of strength.
  { name: '2 tanks + working base', tanks: 2, turrets: 0, defenders: 0, mats: 3000, base: true },
  { name: '6 tanks + working base', tanks: 6, turrets: 0, defenders: 0, mats: 3000, base: true },
];

function runFixture(spec: FixtureSpec) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = 424242;
  scenario.settings.fog = true;
  scenario.settings.startingMats = spec.mats ?? 0;
  scenario.settings.startingReq = 0;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[1].factionId = 'baltic';
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 52, z: 32 },
    { defId: 'commandPost', owner: 1, x: 12, z: 32 },
  );
  for (let i = 0; i < spec.turrets; i++) {
    scenario.structures.push({ defId: 'atTurret', owner: 0, x: 48, z: 30 + i * 4 });
  }
  for (let i = 0; i < spec.defenders; i++) {
    scenario.units.push({ defId: 'tank', owner: 0, x: 50, z: 35 + i * 2 });
  }
  if (spec.repairEngineer) {
    scenario.units.push({ defId: 'engineer', owner: 0, x: 53, z: 33 });
  }
  if (spec.base) {
    scenario.structures.push(
      { defId: 'powerPlant', owner: 1, x: 8, z: 28 },
      { defId: 'barracks', owner: 1, x: 14, z: 36 },
      { defId: 'factory', owner: 1, x: 8, z: 36 },
      { defId: 'refinery', owner: 1, x: 15, z: 29 },
    );
    scenario.units.push(
      { defId: 'engineer', owner: 1, x: 13, z: 31 },
      { defId: 'harvester', owner: 1, x: 17, z: 33 },
    );
  }
  for (let i = 0; i < spec.tanks; i++) {
    scenario.units.push({ defId: 'tank', owner: 1, x: 30 + i * 2, z: 32 });
  }
  if (orePerTile > 0) {
    // A normal field, so an exhausted commander is not merely a poor map.
    for (const x of [8, 9, 20, 21]) {
      for (const z of [27, 28, 38, 39]) {
        scenario.tiles[z * scenario.width + x].o = orePerTile;
        scenario.tiles[z * scenario.width + (scenario.width - 1 - x)].o = orePerTile;
      }
    }
  }

  const game = new Game(scenario, { enableAI: false });
  const ai = new AIController({ resolveApproach });
  const state = initialAIState(99, 'veteran');
  const enemyPost = game
    .entitiesOf(0, 'building')
    .find((b) => b.defId === 'commandPost')!;
  const tanks = (): Entity[] => game.entitiesOf(1, 'unit').filter((u) => u.defId === 'tank');
  const start = tanks().map((t) => ({ id: t.id, x: t.x, z: t.z }));

  // A remembered sighting, exactly what reconnaissance leaves behind.
  game.state.contacts.push({
    team: game.teamOf(1),
    entityId: enemyPost.id,
    x: enemyPost.x,
    z: enemyPost.z,
    tick: 0,
    defId: 'commandPost',
    kind: 'building',
  });

  if (spec.postDamage) enemyPost.hp = enemyPost.maxHp * (1 - spec.postDamage);
  if (spec.repairEngineer) {
    const engineer = game.entitiesOf(0, 'unit').find((u) => u.defId === 'engineer');
    if (engineer) {
      game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: enemyPost.id });
    }
  }
  const postStartHp = enemyPost.hp;
  const postHpStart = enemyPost.maxHp;
  let firstOrderSeconds: number | null = null;
  let orderedToPost = false;
  let closest = 999;
  let lastDecision = '';
  let phase = '';
  for (let i = 0; i < seconds * 20; i++) {
    game.tick();
    ai.update(game, 1, state);
    // Keep the sighting fresh: a commander whose scouts are watching the base
    // should not lose the trail and start scouting again.
    const contact = game.state.contacts.find((c) => c.entityId === enemyPost.id);
    if (contact) contact.tick = game.state.tick;
    lastDecision = state.lastDecision ?? '';
    phase = state.phase;
    for (const t of tanks()) {
      closest = Math.min(closest, dist(t.x, t.z, enemyPost.x, enemyPost.z) / TILE_SIZE);
      const order = t.order;
      if (!order) continue;
      const towardPost =
        order.type === 'attack'
          ? order.targetId === enemyPost.id
          : dist(order.x, order.z, enemyPost.x, enemyPost.z) <= 6 * TILE_SIZE;
      if (towardPost && firstOrderSeconds === null) firstOrderSeconds = +(game.state.tick / 20).toFixed(1);
      if (towardPost) orderedToPost = true;
    }
  }

  const alive = tanks().length;
  const moved = tanks().some((t) => {
    const s = start.find((p) => p.id === t.id);
    return s ? dist(t.x, t.z, s.x, s.z) / TILE_SIZE > 6 : false;
  });

  return {
    fixture: spec.name,
    tanks: spec.tanks,
    turrets: spec.turrets,
    defenders: spec.defenders,
    mats: spec.mats ?? 0,
    orePerTile,
    resolveApproach,
    tanksLost: spec.tanks - alive,
    aliveAtEnd: alive,
    postDamage: Math.round(postStartHp - enemyPost.hp),
    postEndHp: Math.round(enemyPost.hp),
    postDestroyed: enemyPost.hp <= 0,
    firstOrderSeconds,
    orderedToPost,
    moved,
    closestToPostTiles: +closest.toFixed(1),
    phase,
    lastDecision,
  };
}

const results = FIXTURES.map(runFixture);
for (const r of results) console.log(JSON.stringify({ event: 'fixture', ...r }));

const committed = results.filter((r) => r.orderedToPost);
const smallest = committed
  .map((r) => r.tanks)
  .reduce((n, v) => Math.min(n, v), Number.POSITIVE_INFINITY);
console.log(
  JSON.stringify({
    event: 'summary',
    seconds,
    committed: committed.map((r) => r.fixture),
    refused: results.filter((r) => !r.orderedToPost).map((r) => r.fixture),
    smallestCommittedForce: Number.isFinite(smallest) ? smallest : null,
  }),
);
