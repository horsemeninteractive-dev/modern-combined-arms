/**
 * National-kit reach probe.
 *
 * Answers one question: what does an AI commander actually put on the field?
 * The matchup harness scores a match, so it cannot show whether a researched
 * branch was ever followed through. This probe plays an authored map and
 * samples every entity each second, recording the structures, unit families and
 * technologies each side has ever owned.
 *
 *   npx tsx tools/ai-kit-probe.ts [map=open-front] [difficulty=elite] [seconds=600] [seeds=1]
 *
 * `MCA_PROBE_TRACE=1` prints the west commander's decision every ten seconds.
 * Diagnostics only: nothing under `src/` imports it and it changes no game
 * behaviour.
 */
import { Game } from '../src/sim/game';
import { requireScenario } from '../src/data/scenarioCatalog';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { UNITS, unitFamily } from '../src/data/units';

interface Seen {
  buildings: Set<string>;
  units: Set<string>;
  techs: Set<string>;
  lastDecision: string;
  phase: string;
}

function run(mapId: string, difficulty: AIDifficulty, seconds: number, seed: number, nation?: [string, string]) {
  const scenario = requireScenario(mapId).create();
  scenario.meta.name = `Kit Probe ${mapId}`;
  scenario.settings.startingMats = Number(process.env.MCA_PROBE_MATS ?? 3000);
  scenario.settings.startingReq = Number(process.env.MCA_PROBE_REQ ?? 180);
  if (!process.env.MCA_PROBE_GAMEAI) {
    scenario.players[0].isAI = false;
    scenario.players[1].isAI = false;
  }
  if (nation) {
    scenario.players[0].factionId = nation[0];
    scenario.players[1].factionId = nation[1];
  }
  if (process.env.MCA_PROBE_DEV) {
    // Mirrors tests/ai.test.ts `developedAiGame` on the island assault map.
    scenario.structures.push(
      { defId: 'factory', owner: 1, x: 68, z: 30 },
      { defId: 'refinery', owner: 1, x: 66, z: 34 },
      { defId: 'barracks', owner: 1, x: 78, z: 34 },
    );
    scenario.units.push({ defId: 'harvester', owner: 1, x: 70, z: 36 });
  }
  // Two modes: a symmetric probe with one controller per seat on the same
  // seed, or the game's own seeded commander exactly as a skirmish drives it.
  const gameAI = !!process.env.MCA_PROBE_GAMEAI;
  const game = new Game(scenario, { enableAI: gameAI, aiDifficulty: difficulty });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(seed, difficulty);
  const eastState = initialAIState(seed + 977, difficulty);
  const seen: Seen[] = [
    { buildings: new Set(), units: new Set(), techs: new Set(), lastDecision: '', phase: '' },
    { buildings: new Set(), units: new Set(), techs: new Set(), lastDecision: '', phase: '' },
  ];
  const timeline: string[] = [];
  const firstSeen = new Map<string, number>();
  const note = (tick: number, id: number, kind: string, family: string) => {
    const key = `${id}:${kind}:${family}`;
    if (firstSeen.has(key)) return;
    firstSeen.set(key, tick);
    timeline.push(`  t+${Math.round(tick / 20)}s P${id} ${family}`);
  };
  let tick = 0;
  for (; tick < 20 * seconds && game.state.victory === 'playing'; tick++) {
    game.tick();
    if (!gameAI) {
      west.update(game, 0, westState);
      east.update(game, 1, eastState);
    }
    if (tick % 200 !== 0) continue;
    if (process.env.MCA_PROBE_TRACE) {
      const w = game.player(0);
      const e = game.player(1);
      if (process.env.MCA_PROBE_GAMEAI) {
        console.log(
          `t+${tick / 20}s AI ${Math.round(e?.mats ?? 0)}m ${Math.round(e?.req ?? 0)}r | ${game.state.ai?.lastDecision ?? '-'}`,
        );
      }
      const techs = (id: number) => game.completedTechnologies(id).join('/') || '-';
      const legalNear = (id: number, defId: string) => {
        const engineer = game
          .entitiesOf(id, 'unit')
          .find((u) => u.hp > 0 && unitFamily(u.defId) === 'engineer');
        const start = scenario.players[id];
        if (!engineer || !start) return 0;
        const cx = start.startX;
        const cz = start.startZ;
        let n = 0;
        for (let dz = -16; dz <= 16; dz++) {
          for (let dx = -16; dx <= 16; dx++) {
            if (game.placementStatus(id, defId, cx + dx, cz + dz, engineer.id, true).ok) n++;
          }
        }
        return n;
      };
      if (tick % 600 === 0) {
        console.log(
          `t+${tick / 20}s sites E shipyard ${legalNear(1, 'shipyard')} airfield ${legalNear(1, 'airfield')} sam ${legalNear(1, 'samBattery')}`,
        );
      }
      const built = (id: number) => {
        const families = new Set(
          game
            .entitiesOf(id, 'building')
            .filter((b) => b.hp > 0 && !b.construction)
            .map((b) => buildingFamily(b.defId)),
        );
        return ['researchCentre', 'airfield', 'heliport', 'shipyard', 'samBattery']
          .filter((f) => families.has(f))
          .map((f) => f.slice(0, 3))
          .join(',') || '-';
      };
      console.log(
        `t+${tick / 20}s  W[${westState.phase}] ${Math.round(w?.mats ?? 0)}m [${built(0)}] ${techs(0)} | ${westState.lastDecision}\n` +
          `          E[${eastState.phase}] ${Math.round(e?.mats ?? 0)}m [${built(1)}] ${techs(1)} | ${eastState.lastDecision}`,
      );
    }
    for (const id of [0, 1]) {
      for (const e of game.entitiesOf(id)) {
        if (e.hp <= 0) continue;
        if (e.kind === 'unit') {
          seen[id].units.add(unitFamily(e.defId));
          note(tick, id, 'unit', unitFamily(e.defId));
          // A family name hides the national replacement: the Finnish K9 is an
          // `spg`, so the timeline also names the definition itself. This is the
          // only direct evidence that a national kit reached the field.
          if (UNITS[e.defId]?.national) note(tick, id, 'national', e.defId);
        } else {
          seen[id].buildings.add(buildingFamily(e.defId));
          note(tick, id, 'building', buildingFamily(e.defId));
          if (BUILDINGS[e.defId]?.national) note(tick, id, 'national', e.defId);
        }
      }
      for (const tech of game.completedTechnologies(id)) {
        if (!seen[id].techs.has(tech)) note(tick, id, 'tech', tech);
        seen[id].techs.add(tech);
      }
    }
    seen[0].lastDecision = westState.lastDecision;
    seen[1].lastDecision = eastState.lastDecision;
    seen[0].phase = westState.phase;
    seen[1].phase = eastState.phase;
  }
  const sites: string[] = [];
  if (process.env.MCA_PROBE_SITES) {
    for (const id of [0, 1]) {
      const engineer = game
        .entitiesOf(id, 'unit')
        .find((u) => u.hp > 0 && unitFamily(u.defId) === 'engineer');
      for (const defId of ['airfield', 'shipyard', 'samBattery']) {
        let legal = 0;
        for (let z = 0; z < scenario.height; z++) {
          for (let x = 0; x < scenario.width; x++) {
            if (game.placementStatus(id, defId, x, z, engineer?.id ?? 0, true).ok) legal++;
          }
        }
        sites.push(`  P${id} ${defId} legal sites: ${legal}`);
      }
    }
  }
  return { victory: game.state.victory, seen, elapsed: tick / 20, timeline, sites };
}

const args = process.argv.slice(2);
const mapId = args[0] ?? 'open-front';
const difficulty = (args[1] ?? 'elite') as AIDifficulty;
const seconds = Number(args[2] ?? 600);
const seeds = Number(args[3] ?? 1);

// `MCA_PROBE_NATIONS=finland,russia` plays one national matchup instead of the
// shared baseline, which is how a national kit's own variant is watched for.
const nationArg = process.env.MCA_PROBE_NATIONS?.split(',').map((n) => n.trim());
const nations: [string, string] | undefined =
  nationArg?.length === 2 ? [nationArg[0], nationArg[1]] : undefined;

const tally = {
  buildings: new Map<string, number>(),
  units: new Map<string, number>(),
  techs: new Map<string, number>(),
};
const matches: string[] = [];
for (let i = 0; i < seeds; i++) {
  const { victory, seen, elapsed, timeline, sites } = run(mapId, difficulty, seconds, 101 + i * 977, nations);
  matches.push(`seed ${i}: ${victory} after ${Math.round(elapsed)}s`);
  if (process.env.MCA_PROBE_TIMELINE) matches.push(...timeline);
  if (process.env.MCA_PROBE_SITES) matches.push(...sites);
  for (const side of seen) {
    for (const b of side.buildings) tally.buildings.set(b, (tally.buildings.get(b) ?? 0) + 1);
    for (const u of side.units) tally.units.set(u, (tally.units.get(u) ?? 0) + 1);
    for (const t of side.techs) tally.techs.set(t, (tally.techs.get(t) ?? 0) + 1);
    matches.push(
      `  side: ${side.phase} | buildings ${[...side.buildings].sort().join(',')} | units ${[...side.units].sort().join(',')} | techs ${[...side.techs].sort().join(',')}`,
    );
  }
}
const sorted = (m: Map<string, number>) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
console.log(matches.join('\n'));
console.log(`\n${mapId} ${difficulty} x${seeds} at ${seconds}s (${seeds * 2} sides)`);
console.log(`buildings: ${sorted(tally.buildings)}`);
console.log(`units:     ${sorted(tally.units)}`);
console.log(`techs:     ${sorted(tally.techs)}`);
