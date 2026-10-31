import { readFileSync } from 'node:fs';

const source = readFileSync('tools/phase2a9-ab-calibration.mjs', 'utf8');

describe('Phase 2A.9 A/B calibration harness', () => {
  it('uses a fixed bounded workload plan and session-scoped run ids', () => {
    expect(source).toContain('const batches = [0, 1, 5, 20, 100];');
    expect(source).toContain('const runPrefix = `p2a9-${session}`;');
    expect(source).toContain('MP_PHASE2A9_SESSION must be A1..A3 or B1..B3.');
    expect(source).toMatch(/reps < 1 \|\| reps > 10/);
    expect(source).toMatch(/extraBatch1 < 0 \|\| extraBatch1 > 30/);
    expect(source).toContain('assert.equal(calibration?.completedTicks, batch');
    expect(source).toContain('assert.ok(calibration?.final?.checksum)');
  });

  it('closes the temporary room and verifies reservation release', () => {
    expect(source).toContain("roomPath(roomId, '/shutdown')");
    expect(source).toContain("finalStatus?.data?.reservation?.status");
    expect(source).toContain("'temporary reservation must be released'");
    expect(source).toContain("'temporary room must be closed'");
  });

  it('does not persist the admin token, use clocks, or add random workload choices', () => {
    const writes = source.match(/writeFileSync\([^)]*/g) ?? [];
    expect(writes.join('\n')).not.toContain('admin');
    expect(source).not.toContain('performance.now');
    expect(source).not.toContain('Date.now() - startedAt');
    expect(source).not.toContain('Math.random');
    expect(source).toContain('Invocation CPU includes fresh Game construction');
  });

  it('keeps calibration admin-only and rejects invalid batches', () => {
    expect(source).toContain("assert.equal(unauthorized.status, 403");
    expect(source).toContain("['baseline', 1000, 'invalid-calibration']");
    expect(source).toContain("assert.equal(invalid.data.code, expectedCode)");
    expect(source).toContain("assert.equal(plain.data.calibration, undefined)");
  });
});
