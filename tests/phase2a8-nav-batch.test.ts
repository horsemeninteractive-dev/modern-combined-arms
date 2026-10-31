import { NavBatch, type NavBatchMember } from '../src/sim/navBatch';

/**
 * The command-scoped batch must reproduce the exact soft-traffic values of the
 * old per-request scan, including its last-writer-wins assignment when several
 * units share a tile.
 */
describe('Phase 2A.8 command-scoped navigation batch', () => {
  function batchOf(members: NavBatchMember[]): NavBatch {
    return new NavBatch(8, 8, members);
  }

  it('uses the same last-writer-wins value as the old scan', () => {
    const batch = batchOf([
      { id: 1, tile: 0, domain: 'land', moving: false },
      { id: 2, tile: 0, domain: 'land', moving: true },
      { id: 3, tile: 5, domain: 'land', moving: false },
      { id: 4, tile: 5, domain: 'sea', moving: true },
    ]);

    const land = batch.softFor('land')!;
    const sea = batch.softFor('sea')!;
    expect(land[0]).toBe(2);
    expect(land[5]).toBe(1);
    expect(sea[5]).toBe(2);
    expect(sea[0]).toBe(0);
    expect(batch.softFor('air')).toBeUndefined();
  });

  it('changes a shared tile only when its last writer changes', () => {
    const batch = batchOf([
      { id: 1, tile: 0, domain: 'land', moving: false },
      { id: 2, tile: 0, domain: 'land', moving: true },
    ]);
    const soft = batch.softFor('land')!;
    expect(soft[0]).toBe(2);

    // An earlier writer changing state does not move the tile: the later
    // entity still owns it in the old scan.
    batch.refresh(1, true);
    expect(soft[0]).toBe(2);

    // The last writer becoming idle moves the tile to holding-position traffic.
    batch.refresh(2, false);
    expect(soft[0]).toBe(1);

    // The earlier entity was already refreshed to moving, so making the last
    // writer moving again restores moving traffic.
    batch.refresh(2, true);
    expect(soft[0]).toBe(2);
  });

  it('ignores unknown ids and does not leak state between batches', () => {
    const first = batchOf([{ id: 1, tile: 0, domain: 'land', moving: true }]);
    first.refresh(999, false);
    expect(first.softFor('land')![0]).toBe(2);

    const second = batchOf([{ id: 2, tile: 0, domain: 'land', moving: false }]);
    expect(second.softFor('land')![0]).toBe(1);
    expect(first.softFor('land')![0]).toBe(2);
  });

  it('handles an empty batch without allocating a mask', () => {
    const batch = batchOf([]);
    expect(batch.softFor('land')).toBeUndefined();
    expect(() => batch.refresh(1, true)).not.toThrow();
  });
});
