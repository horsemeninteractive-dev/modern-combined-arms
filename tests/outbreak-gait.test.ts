import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INFECTED_GAIT,
  infectedGaitPose,
  infectedGaitProfile,
  infectedLegSwing,
} from '../src/render/infectedGait';
import { unitStyle } from '../src/render/unitMeshes';
import { gaitModelMatrix } from '../src/render/unitTransform';
import { modelMatrix } from '../src/render/math';
import { ZOMBIE_DEF_IDS } from '../src/data/zombies';

/** The archetypes that walk. The flyer hovers and carries no leg rig. */
const IDS = Object.values(ZOMBIE_DEF_IDS).filter((id) => id !== ZOMBIE_DEF_IDS.flyer);

/** Lowest vertex of a mesh, which for a limb is its foot. */
function minY(positions: Float32Array): number {
  let min = Infinity;
  for (let i = 1; i < positions.length; i += 3) min = Math.min(min, positions[i]);
  return min;
}

describe('infected gait', () => {
  it('gives every archetype a profile and a hip-pivot rig to walk on', () => {
    for (const id of IDS) {
      expect(infectedGaitProfile(id), id).not.toBeNull();
      const style = unitStyle(id);
      expect(style, id).toBeDefined();
      expect(style!.infantry, id).toBeDefined();
      expect(style!.infantry!.leg.positions.length, id).toBeGreaterThan(0);
    }
  });

  it('leaves the flyer off the walking path entirely', () => {
    // A body in the air has no stride to author: it carries no limb and no
    // profile, so nothing in the gait system can swing it.
    expect(infectedGaitProfile(ZOMBIE_DEF_IDS.flyer)).toBeNull();
    expect(unitStyle(ZOMBIE_DEF_IDS.flyer)!.infantry).toBeUndefined();
  });

  it('leaves every other definition on the unauthored path', () => {
    // The roster keeps its own leg rig and its own swing; only the horde has a
    // body gait. A pedestrian profile leaking onto a tank would rock a hull.
    for (const id of ['rifle', 'medic', 'tank', 'spg', 'corvette', 'zombieShamblerX']) {
      expect(infectedGaitProfile(id), id).toBeNull();
    }
  });

  it('puts each limb on the ground from its hip pivot', () => {
    for (const id of IDS) {
      const rig = unitStyle(id)!.infantry!;
      const sole = rig.hip[1] + minY(rig.leg.positions);
      // Sole at the unit origin: a leg that stops short leaves the body hanging
      // in the air, and one that runs long ploughs into the terrain.
      expect(Math.abs(sole), `${id} sole ${sole.toFixed(3)}`).toBeLessThan(0.06);
    }
  });

  it('holds a stopped body still, so a waiting wave does not twitch', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      const pose = infectedGaitPose(profile, 2.4, 0);
      expect(Math.abs(pose.bob), id).toBe(0);
      expect(Math.abs(pose.roll), id).toBe(0);
      expect(Math.abs(pose.pitch), id).toBe(0);
      expect(Math.abs(pose.sway), id).toBe(0);
      // The stoop is posture, not motion: it is held at any pace.
      expect(pose.lean, id).toBe(profile.lean);
      expect(infectedLegSwing(profile, pose, 0), id).toBe(profile.legBase);
    }
  });

  it('never sinks the body into the ground while striding', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      for (let phase = 0; phase < Math.PI * 4; phase += 0.05) {
        const pose = infectedGaitPose(profile, phase, 1);
        expect(pose.bob, id).toBeGreaterThanOrEqual(0);
        expect(pose.bob, id).toBeLessThan(0.2);
        expect(Math.abs(pose.roll), id).toBeLessThan(0.3);
      }
    }
  });

  it('names each archetype by its motion alone', () => {
    const shambler = INFECTED_GAIT[ZOMBIE_DEF_IDS.shambler];
    const runner = INFECTED_GAIT[ZOMBIE_DEF_IDS.runner];
    const brute = INFECTED_GAIT[ZOMBIE_DEF_IDS.brute];
    const bloater = INFECTED_GAIT[ZOMBIE_DEF_IDS.bloater];
    const crawler = INFECTED_GAIT[ZOMBIE_DEF_IDS.crawler];

    // Cadence: the sprinter outpaces the mass, the mass outpaces the breaker.
    expect(runner.cadence).toBeGreaterThan(shambler.cadence);
    expect(shambler.cadence).toBeGreaterThan(brute.cadence);
    expect(brute.cadence).toBeGreaterThan(bloater.cadence);
    // Weight: the brute's rise and the bloater's roll are the heaviest reads.
    expect(brute.bob).toBeGreaterThan(shambler.bob);
    expect(bloater.roll).toBeGreaterThan(shambler.roll);
    // A crawler drags side to side harder than anything that stands up.
    for (const other of [shambler, runner, brute, bloater]) {
      expect(crawler.sway).toBeGreaterThan(other.sway);
    }
    // A limp is not a sprint: the shambler's step is the most uneven.
    for (const other of [runner, brute, bloater, crawler]) {
      expect(shambler.hitch).toBeGreaterThan(other.hitch);
    }
  });

  it('banks into a turn and never banks standing still', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      const straight = infectedGaitPose(profile, 1.1, 1);
      const right = infectedGaitPose(profile, 1.1, 1, { turn: 2, press: 0 });
      const left = infectedGaitPose(profile, 1.1, 1, { turn: -2, press: 0 });
      // A right-hand turn throws the body right, a left-hand turn the other way,
      // by the archetype's own bank.
      expect(right.roll - straight.roll).toBeCloseTo(profile.bank);
      expect(left.roll - straight.roll).toBeCloseTo(-profile.bank);
      expect(right.sway).toBeGreaterThan(straight.sway);
      // The bank is a lean, not a spin: past the reference rate it saturates.
      const hard = infectedGaitPose(profile, 1.1, 1, { turn: 40, press: 0 });
      expect(Math.abs(hard.roll - straight.roll)).toBeLessThanOrEqual(profile.bank + 1e-9);
      // Standing still and not turning is a body at rest.
      const idle = infectedGaitPose(profile, 1.1, 0);
      expect(Math.abs(idle.roll)).toBe(0);
    }
  });

  it('leans in and strides harder as it closes on a target', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      const distant = infectedGaitPose(profile, 0.9, 1);
      const contact = infectedGaitPose(profile, 0.9, 1, { turn: 0, press: 1 });
      // The charge is posture: it adds to the stoop the body already carries.
      expect(contact.lean - distant.lean).toBeCloseTo(profile.charge);
      expect(contact.lean).toBeLessThan(0.6);
      // A driven body covers more stride phase in the same time.
      expect(contact.stride).toBeGreaterThan(distant.stride);
      // Pressing while stopped leans the body without making it twitch.
      const held = infectedGaitPose(profile, 0.9, 0, { turn: 0, press: 1 });
      expect(Math.abs(held.bob)).toBe(0);
      expect(Math.abs(held.roll)).toBe(0);
      expect(held.lean).toBeCloseTo(profile.lean + profile.charge);
    }
  });

  it('treats a missing response as no response', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      expect(infectedGaitPose(profile, 2.2, 0.7)).toEqual(
        infectedGaitPose(profile, 2.2, 0.7, { turn: 0, press: 0 }),
      );
    }
  });

  it('is deterministic and continuous from frame to frame', () => {
    const profile = infectedGaitProfile(ZOMBIE_DEF_IDS.shambler)!;
    const a = infectedGaitPose(profile, 1.234, 0.8);
    const b = infectedGaitPose(profile, 1.234, 0.8);
    expect(b).toEqual(a);
    const next = infectedGaitPose(profile, 1.244, 0.8);
    // A one-frame step at 60 Hz cannot teleport the body.
    expect(Math.abs(next.bob - a.bob)).toBeLessThan(0.02);
    expect(Math.abs(next.roll - a.roll)).toBeLessThan(0.02);
  });

  it('swings the two legs out of phase rather than hopping', () => {
    for (const id of IDS) {
      const profile = infectedGaitProfile(id)!;
      const pose = infectedGaitPose(profile, Math.PI / 2 / profile.cadence, 1);
      const swing = infectedLegSwing(profile, pose, 1);
      expect(swing, id).toBeGreaterThan(profile.legBase);
      // The renderer draws the second limb with the negated swing.
      expect(-swing, id).toBeLessThan(0);
    }
  });

  it('degenerates to the ordinary unit matrix when the body is at rest', () => {
    // Standing still, an infected body must be drawn exactly where any other
    // unit body is drawn: the gait multiplies into the same translation, yaw and
    // scale, so a stopped horde cannot drift off its own footprint.
    const pose = infectedGaitPose(infectedGaitProfile(ZOMBIE_DEF_IDS.brute)!, 0, 0);
    const moving = gaitModelMatrix(40, 3, 60, 0.7, 1, { ...pose, lean: 0 });
    const plain = modelMatrix(40, 3, 60, -0.7, 1, 1, 1);
    expect(Array.from(moving)).toEqual(Array.from(plain));
  });

  it('lifts the body with the bob and never moves its feet', () => {
    const profile = infectedGaitProfile(ZOMBIE_DEF_IDS.shambler)!;
    const pose = infectedGaitPose(profile, Math.PI / 4, 1);
    const m = gaitModelMatrix(12, 5, -3, 0, 1, pose);
    // Column-major translation: the origin rises by the bob and stays put
    // laterally, so the shuffle reads on the spot rather than sliding the hull.
    expect(m[13]).toBeCloseTo(5 + pose.bob);
    expect(m[12]).toBeCloseTo(12);
    expect(m[14]).toBeCloseTo(-3);
  });

  it('stays out of the simulation', () => {
    // Presentation only: the module may not reach into the game, the director
    // or the network, which is what keeps a cosmetic gait out of saves and
    // out of a co-op peer's state.
    const source = readFileSync('src/render/infectedGait.ts', 'utf8');
    expect(source).not.toMatch(/from '\.\.\/(sim|outbreak|multiplayer|data|app)/);
  });
});
