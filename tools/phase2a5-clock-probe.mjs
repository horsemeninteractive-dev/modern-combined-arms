#!/usr/bin/env node
// Phase 2A.5 deployed clock-capability probe.
//
// Creates one short staging room, then calls the admin-only status route with
// `?probe=timing`. The probe runs bounded synchronous CPU work and reports
// whether each candidate clock advanced. It never prints the admin token or
// room seat tokens.
//
//   MP_ADMIN_TOKEN=<token> node tools/phase2a5-clock-probe.mjs
//
// Evidence is written under staging-evidence/phase2a5-clock-probe-<stamp>/.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base =
  process.env.MP_BASE ?? 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
const admin =
  process.env.MP_ADMIN_TOKEN ??
  (() => {
    try {
      return readFileSync('.dev/mp-admin-token', 'utf8').trim();
    } catch {
      return '';
    }
  })();
if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join('staging-evidence', `phase2a5-clock-probe-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const eventsPath = join(evidenceDir, 'events.jsonl');
const resultPath = join(evidenceDir, 'probe.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const at = () => new Date().toISOString();
const roomPath = (roomId, suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

function event(record) {
  appendFileSync(eventsPath, JSON.stringify({ at: at(), ...record }) + '\n');
  console.log(JSON.stringify(record));
}

async function api(path, method = 'GET', body, token = admin) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ ok: false, code: 'bad-json' }));
  return { status: response.status, data };
}

async function main() {
  const healthResponse = await fetch(`${base}/api/multiplayer/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.build, 'phase2a5-staging', 'staging build marker');
  assert.equal(health.onlineEnabled, true);
  event({ type: 'health', build: health.build, protocol: health.protocol });

  const roomId = `phase2a5-clock-${Date.now().toString(36)}`;
  const created = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs: 10_000,
  });
  assert.equal(created.status, 200, `create: ${JSON.stringify(created.data)}`);
  assert.equal(created.data.ok, true);
  event({ type: 'room-created', roomId });

  try {
    const unauthorized = await fetch(`${base}${roomPath(roomId, '/status?probe=timing')}`);
    assert.equal(unauthorized.status, 403, 'timing probe must require admin');
    event({ type: 'unauthorized-probe', status: unauthorized.status });

    const invalid = await api(roomPath(roomId, '/status?probe=unknown'));
    assert.equal(invalid.status, 400, 'unknown probe must be rejected');
    assert.equal(invalid.data.code, 'invalid-probe');
    event({ type: 'invalid-probe', status: invalid.status, code: invalid.data.code });

    const plain = await api(roomPath(roomId, '/status'));
    assert.equal(plain.status, 200);
    assert.equal(plain.data.timingProbe, undefined, 'probe data must be opt-in');
    event({ type: 'plain-status', status: plain.status, hasTimingProbe: false });

    const probes = [];
    for (let index = 0; index < 5; index++) {
      const response = await api(roomPath(roomId, '/status?probe=timing'));
      assert.equal(response.status, 200, `probe ${index}: ${JSON.stringify(response.data)}`);
      const probe = response.data.timingProbe;
      assert.equal(probe?.version, 1);
      assert.equal(probe?.method, 'synchronous-cpu-workload');
      assert.deepEqual(probe?.workloadMultipliers, [1, 2, 4]);
      assert.equal(probe?.workloads?.length, 3);
      for (const workload of probe.workloads) {
        assert.equal(workload.clocks.length, 4);
        for (const clock of workload.clocks) {
          assert.equal(typeof clock.available, 'boolean');
          if (clock.available) assert.ok(Number.isFinite(clock.delta) && clock.delta >= 0);
          else assert.equal(clock.delta, null);
        }
      }
      assert.equal(probe.ioYield.length, 4);
      probes.push(probe);
      event({
        type: 'probe',
        index,
        iterations: probe.iterations,
        workloads: probe.workloads.map((workload) => ({
          iterations: workload.iterations,
          checksum: workload.checksum,
          clocks: workload.clocks,
        })),
        ioYield: probe.ioYield,
      });
      await sleep(250);
    }

    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          version: 1,
          base,
          capturedAt: new Date().toISOString(),
          build: health.build,
          roomId,
          unauthorizedStatus: unauthorized.status,
          invalidProbeStatus: invalid.status,
          probes,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    try {
      const closed = await api(roomPath(roomId, '/shutdown'), 'POST', {});
      event({ type: 'room-shutdown', status: closed.status, ok: closed.data?.ok === true });
    } catch (error) {
      event({ type: 'room-shutdown-error', error: String(error).slice(0, 120) });
    }
  }

  console.log(`Evidence: ${evidenceDir}`);
}

main().catch((error) => {
  event({ type: 'fatal', error: String(error).slice(0, 300) });
  process.exit(1);
});
