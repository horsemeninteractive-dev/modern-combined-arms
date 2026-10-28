import { describe, expect, it } from 'vitest';
import { briefMapLabels } from '../src/ui/mapPreview';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';

describe('mission brief map', () => {
  const scenario = createIslandAssault();
  const post = BUILDINGS.commandPost.footprint;

  it('pins each callout to its command post', () => {
    const labels = briefMapLabels(scenario);
    const friend = labels.find((l) => l.side === 'friend')!;
    const enemy = labels.find((l) => l.side === 'enemy')!;
    const friendlyPost = scenario.structures.find((s) => s.defId === 'commandPost' && s.owner === 0)!;
    const enemyPost = scenario.structures.find((s) => s.defId === 'commandPost' && s.owner === 1)!;

    expect(friend.x).toBeCloseTo(((friendlyPost.x + post.w / 2) / scenario.width) * 100, 2);
    expect(friend.z).toBeCloseTo(((friendlyPost.z + post.h / 2) / scenario.height) * 100, 2);
    expect(enemy.x).toBeCloseTo(((enemyPost.x + post.w / 2) / scenario.width) * 100, 2);
    expect(enemy.z).toBeCloseTo(((enemyPost.z + post.h / 2) / scenario.height) * 100, 2);
    // The beachhead is west, the expeditionary corps east.
    expect(friend.x).toBeLessThan(enemy.x);
  });

  it('keeps fallback callouts inside the frame', () => {
    const bare = createIslandAssault();
    bare.structures = bare.structures.filter((s) => s.defId !== 'commandPost');
    for (const label of briefMapLabels(bare)) {
      expect(label.x).toBeGreaterThan(0);
      expect(label.x).toBeLessThan(100);
      expect(label.z).toBeGreaterThan(0);
      expect(label.z).toBeLessThan(100);
    }
  });
});
