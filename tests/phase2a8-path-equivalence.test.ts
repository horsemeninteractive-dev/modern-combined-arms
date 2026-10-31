import { findPath as findPathOptimised, pathLength as pathLengthOptimised } from '../src/sim/pathfinding';
import {
  findPath as findPathReference,
  pathLength as pathLengthReference,
  type NavGrid as ReferenceNavGrid,
} from './pathfinding-reference';
import { pathFixtureCases } from './pathfinding-fixtures';
import { Terrain } from '../src/sim/terrain';
import type { MoveClass } from '../src/sim/types';
import type { NavGrid } from '../src/sim/pathfinding';
import baseline from './fixtures/phase2a8-path-baseline.json';

/**
 * Phase 2A.8 path equality.
 *
 * `tests/pathfinding-reference.ts` is a verbatim copy of the pre-optimisation
 * A* and object-node heap. It is the old-versus-new oracle; the JSON fixture is
 * a pre-optimisation capture from a reconstructed old source tree that also
 * reproduces every Phase 2A.6 deployed checksum.
 */

interface CapturedPath {
  name: string;
  path: Array<{ x: number; z: number }> | null;
}

const captured = baseline.paths as CapturedPath[];

describe('Phase 2A.8 path equality', () => {
  it.each(pathFixtureCases())('matches the recorded and reference path: $name', (fixture) => {
    const recorded = captured.find((entry) => entry.name === fixture.name);
    expect(recorded).toBeDefined();

    const optimised = findPathOptimised(
      fixture.nav,
      fixture.startX,
      fixture.startZ,
      fixture.goalX,
      fixture.goalZ,
      fixture.maxNodes,
    );
    const reference = findPathReference(
      fixture.nav,
      fixture.startX,
      fixture.startZ,
      fixture.goalX,
      fixture.goalZ,
      fixture.maxNodes,
    );

    expect(optimised).toEqual(reference);
    expect(optimised).toEqual(recorded!.path);
    if (optimised && reference) {
      expect(pathLengthOptimised(optimised)).toBe(pathLengthReference(reference));
    }
  });

  it('is stable across repeated searches and independent calls', () => {
    for (const fixture of pathFixtureCases()) {
      const once = findPathOptimised(
        fixture.nav,
        fixture.startX,
        fixture.startZ,
        fixture.goalX,
        fixture.goalZ,
        fixture.maxNodes,
      );
      for (let repeat = 0; repeat < 5; repeat++) {
        expect(
          findPathOptimised(
            fixture.nav,
            fixture.startX,
            fixture.startZ,
            fixture.goalX,
            fixture.goalZ,
            fixture.maxNodes,
          ),
        ).toEqual(once);
      }
    }
  });

  it('matches the reference over deterministic obstacle, traffic and profile fuzz', () => {
    let seed = 0x2a8c0de;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const classes: MoveClass[] = ['foot', 'tracked', 'wheeled', 'naval'];

    for (let caseIndex = 0; caseIndex < 48; caseIndex++) {
      const width = 18;
      const height = 14;
      const moveClass = classes[caseIndex % classes.length];
      const terrain = new Uint8Array(width * height).fill(Terrain.Grass);
      const elevation = new Uint8Array(width * height);
      const occupied = new Uint8Array(width * height);
      const soft = new Uint8Array(width * height);

      if (moveClass === 'naval') {
        for (let z = 0; z < height; z++) {
          for (let x = 0; x < width; x++) {
            terrain[z * width + x] = x < 6 ? Terrain.ShallowWater : Terrain.DeepWater;
          }
        }
      } else {
        for (let index = 0; index < terrain.length; index++) {
          const roll = random();
          if (roll < 0.12) occupied[index] = 1;
          else if (roll < 0.22 && moveClass === 'foot') terrain[index] = Terrain.Forest;
          else if (roll < 0.3) terrain[index] = Terrain.Rock;
        }
        for (let index = 0; index < soft.length; index++) {
          const roll = random();
          if (roll < 0.08) soft[index] = 1;
          else if (roll < 0.14) soft[index] = 2;
        }
      }
      for (let index = 0; index < elevation.length; index++) {
        if (random() < 0.18) elevation[index] = 1;
        else if (random() < 0.05) elevation[index] = 2;
      }

      const nav: NavGrid = {
        width,
        height,
        terrain,
        elevation,
        moveClass,
        occupied,
        soft,
      };
      const startX = Math.floor(random() * width);
      const startZ = Math.floor(random() * height);
      const goalX = Math.floor(random() * width);
      const goalZ = Math.floor(random() * height);
      const referenceNav = nav as unknown as ReferenceNavGrid;

      expect(findPathOptimised(nav, startX, startZ, goalX, goalZ)).toEqual(
        findPathReference(referenceNav, startX, startZ, goalX, goalZ),
      );
    }
  });
});
