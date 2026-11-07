import { describe, expect, it } from 'vitest';
import { ROTOR_IDLE, stepRotorPower } from '../src/render/rotorSpool';

/**
 * Rotor spool.
 *
 * The point of the model is that blade speed is continuous: a helicopter that
 * lifts off must not snap to full rate inside a frame, and one that lands must
 * keep turning long enough to look like a disc coasting down.
 */

const DT = 1 / 60;

function run(power: number, aloft: boolean, seconds: number): number {
  let p = power;
  for (let i = 0; i < Math.round(seconds / DT); i++) p = stepRotorPower(p, aloft, DT);
  return p;
}

describe('rotor spool', () => {
  it('cranks the disc slowly before the engine catches', () => {
    const afterOneFrame = stepRotorPower(0, true, DT);
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(0.05);
    // Still well below cruise a second in: the starter, not the turbine.
    expect(run(0, true, 1)).toBeLessThan(0.4);
    expect(run(0, true, 1)).toBeGreaterThan(0.2);
  });

  it('reaches full rate over several seconds, not one frame', () => {
    expect(run(0, true, 3)).toBeGreaterThan(0.8);
    expect(run(0, true, 8)).toBeGreaterThan(0.97);
    expect(run(0, true, 60)).toBeLessThanOrEqual(1);
  });

  it('never overshoots full rate', () => {
    expect(run(0.999, true, 2)).toBeLessThanOrEqual(1);
  });

  it('coasts down for about five seconds instead of freezing', () => {
    // Two seconds after touchdown the disc is still turning fast enough to read.
    const afterTwo = run(1, false, 2);
    expect(afterTwo).toBeGreaterThan(0.2);
    expect(afterTwo).toBeLessThan(0.65);
    // And it does come to a complete stop rather than creeping forever.
    expect(run(1, false, 10)).toBe(0);
  });

  it('holds an idle disc while the starter is still cranking', () => {
    expect(stepRotorPower(ROTOR_IDLE, false, 0)).toBe(ROTOR_IDLE);
    expect(run(0, false, 5)).toBe(0);
  });

  it('is stable under a long frame and a zero frame', () => {
    expect(stepRotorPower(0.5, true, 0)).toBe(0.5);
    const longFrame = stepRotorPower(0.5, true, 0.25);
    expect(longFrame).toBeGreaterThan(0.5);
    expect(longFrame).toBeLessThanOrEqual(1);
  });
});
