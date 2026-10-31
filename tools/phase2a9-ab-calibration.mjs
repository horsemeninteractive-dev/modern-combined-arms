#!/usr/bin/env node
// Phase 2A.9 deployed A/B calibration session.
//
// One invocation of this script is one deployment session (for example A1 or
// B2). It creates a short-lived staging room, shuts it down, warms the Durable
// Object, then runs the exact Phase 2A.6/2A.7 calibration workload with unique
// run ids. CPU is joined later from Workers Observability by run id.
//
// Required:
//   MP_PHASE2A9_SESSION=A1   Session label: A1..A3 or B1..B3
//   MP_PHASE2A9_VERSION_ID=<worker version id>
//
// Optional:
//   MP_CALIBRATION_REPS=6          Main repetitions per profile/batch
//   MP_PHASE2A9_EXTRA_BATCH1=12    Extra stress batch-1 repetitions
//   MP_SAMPLE_INTERVAL_MS=250      Pacing between calibration requests
//
// A token is read from MP_ADMIN_TOKEN or .dev/mp-admin-token and is never
// written to evidence.

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

const session = process.env.MP_PHASE2A9_SESSION ?? '';
if (!/^[AB][1-3]$/.test(session)) {
  console.error('MP_PHASE2A9_SESSION must be A1..A3 or B1..B3.');
  process.exit(2);
}
const build = session[0];
const versionId = process.env.MP_PHASE2A9_VERSION_ID?.trim() ?? '';
if (!versionId) {
  console.error('MP_PHASE2A9_VERSION_ID is required.');
  process.exit(2);
}
const sourceRevision = process.env.MP_PHASE2A9_SOURCE_REV?.trim() ?? '132ccc8';
const artifactSha256 = process.env.MP_PHASE2A9_ARTIFACT_SHA256?.trim() ?? null;

const batches = [0, 1, 5, 20, 100];
const profiles = ['baseline', 'stress'];
const reps = Number(process.env.MP_CALIBRATION_REPS ?? 6);
const extraBatch1 = Number(process.env.MP_PHASE2A9_EXTRA_BATCH1 ?? 12);
const sampleIntervalMs = Number(process.env.MP_SAMPLE_INTERVAL_MS ?? 250);
if (!Number.isInteger(reps) || reps < 1 || reps > 10) {
  console.error('MP_CALIBRATION_REPS must be an integer from 1 to 10.');
  process.exit(2);
}
if (!Number.isInteger(extraBatch1) || extraBatch1 < 0 || extraBatch1 > 30) {
  console.error('MP_PHASE2A9_EXTRA_BATCH1 must be an integer from 0 to 30.');
  process.exit(2);
}
if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 0 || sampleIntervalMs > 2000) {
  console.error('MP_SAMPLE_INTERVAL_MS must be an integer from 0 to 2000.');
  process.exit(2);
}

const runPrefix = `p2a9-${session}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join('staging-evidence', `phase2a9-${session}-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const requestsPath = join(evidenceDir, 'requests.jsonl');
const samplesPath = join(evidenceDir, 'samples.json');
const summaryPath = join(evidenceDir, 'session.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const at = () => new Date().toISOString();
const roomPath = (roomId, suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

function event(record) {
  appendFileSync(requestsPath, JSON.stringify({ at: at(), ...record }) + '\n');
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
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, code: 'bad-json' };
  }
  return { status: response.status, data, bytes: Buffer.byteLength(text) };
}

function calibrationPath(roomId, profile, batch, run) {
  const query = new URLSearchParams({
    calibrate: profile,
    batch: String(batch),
    run,
  });
  return roomPath(roomId, `/status?${query.toString()}`);
}

async function sample(roomId, profile, batch, run, extra = false) {
  const response = await api(calibrationPath(roomId, profile, batch, run));
  assert.equal(response.status, 200, `calibration ${run}: ${JSON.stringify(response.data)}`);
  const calibration = response.data.calibration;
  assert.equal(calibration?.completedTicks, batch, `${run} completed ticks`);
  assert.equal(calibration?.requestedTicks, batch, `${run} requested ticks`);
  assert.equal(calibration?.runId, run);
  assert.equal(calibration?.profile, profile);
  assert.ok(calibration?.initial?.checksum);
  assert.ok(calibration?.final?.checksum);
  const record = {
    run,
    session,
    build,
    profile,
    batch,
    extraBatch1: extra,
    completedTicks: calibration.completedTicks,
    checksum: calibration.final.checksum,
    initialChecksum: calibration.initial.checksum,
    finalTick: calibration.finalTick,
    units: calibration.final.units,
    projectiles: calibration.final.projectiles,
    shots: calibration.activity.shots,
    kills: calibration.activity.kills,
    commandsIssued: calibration.commandsIssued,
    commandEntityIds: calibration.commandEntityIds,
    rngState: calibration.rngState,
    responseBytes: response.bytes,
    at: at(),
  };
  event({
    type: 'sample',
    run,
    profile,
    batch,
    extraBatch1: extra,
    completedTicks: calibration.completedTicks,
    checksum: calibration.final.checksum,
    responseBytes: response.bytes,
  });
  if (sampleIntervalMs > 0) await sleep(sampleIntervalMs);
  return record;
}

async function main() {
  const startedAt = at();
  const healthResponse = await fetch(`${base}/api/multiplayer/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.build, 'phase2a6-staging', 'staging build marker');
  assert.equal(health.onlineEnabled, true);
  assert.equal(health.devMode, true);
  event({ type: 'health', session, build, versionId, health });

  const roomId = `p2a9-${session.toLowerCase()}-${Date.now().toString(36)}`;
  const created = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs: 10_000,
  });
  assert.equal(created.status, 200, `create: ${JSON.stringify(created.data)}`);
  event({ type: 'room-created', roomId, reservation: created.data.matchDeadlineAt });

  const samples = [];
  let finalStatus = null;
  try {
    const shutdown = await api(roomPath(roomId, '/shutdown'), 'POST', {});
    assert.equal(shutdown.status, 200, `shutdown: ${JSON.stringify(shutdown.data)}`);
    event({ type: 'room-shutdown', roomId });

    const unauthorized = await fetch(`${base}${calibrationPath(roomId, 'baseline', 0, 'unauth')}`);
    assert.equal(unauthorized.status, 403, 'calibration must require admin');
    event({ type: 'unauthorized-calibration', status: unauthorized.status });

    for (const [profile, batch, expectedCode] of [
      ['unknown', 0, 'invalid-calibration'],
      ['baseline', 2, 'invalid-calibration'],
      ['baseline', 1000, 'invalid-calibration'],
    ]) {
      const invalid = await api(calibrationPath(roomId, profile, batch, 'invalid'));
      assert.equal(invalid.status, 400, `invalid ${profile}/${batch}`);
      assert.equal(invalid.data.code, expectedCode);
      event({
        type: 'invalid-calibration',
        profile,
        batch,
        status: invalid.status,
        code: invalid.data.code,
      });
    }

    const plain = await api(roomPath(roomId, '/status'));
    assert.equal(plain.status, 200);
    assert.equal(plain.data.calibration, undefined);
    event({ type: 'plain-status', status: plain.status, hasCalibration: false });

    // Warm the object, metadata load and JIT before any measured invocation.
    for (let index = 0; index < 2; index++) {
      const warm = await api(calibrationPath(roomId, 'baseline', 0, `${runPrefix}-warmup-${index}`));
      assert.equal(warm.status, 200, `warmup: ${JSON.stringify(warm.data)}`);
      assert.equal(warm.data.calibration?.completedTicks, 0);
      event({ type: 'warmup', index, run: `${runPrefix}-warmup-${index}`, bytes: warm.bytes });
      await sleep(250);
    }

    for (let rep = 0; rep < reps; rep++) {
      const order = rep % 2 === 0 ? profiles : [...profiles].reverse();
      for (const batch of batches) {
        for (const profile of order) {
          const run = `${runPrefix}-${profile}-${batch}-${rep}`;
          samples.push(await sample(roomId, profile, batch, run));
        }
      }
    }

    // Extra first-tick observations: the 72-path burst is the primary
    // optimisation target, while the broad batch series estimates aggregate
    // and sustained cost.
    for (let index = 0; index < extraBatch1; index++) {
      const run = `${runPrefix}-stress-1-extra-${index}`;
      samples.push(await sample(roomId, 'stress', 1, run, true));
    }
  } finally {
    finalStatus = await api(roomPath(roomId, '/status')).catch(() => null);
    event({
      type: 'final-room-status',
      status: finalStatus?.status ?? null,
      closed: finalStatus?.data?.closed ?? null,
      reservation: finalStatus?.data?.reservation ?? null,
    });
  }

  assert.equal(finalStatus?.status, 200, 'final status must be readable');
  assert.equal(finalStatus?.data?.closed, true, 'temporary room must be closed');
  assert.equal(
    finalStatus?.data?.reservation?.status,
    'released',
    'temporary reservation must be released',
  );

  const byCell = {};
  for (const record of samples) {
    const key = `${record.profile}/${record.batch}${record.extraBatch1 ? '/extra' : ''}`;
    byCell[key] ??= { n: 0, checksums: new Set() };
    byCell[key].n++;
    byCell[key].checksums.add(record.checksum);
  }
  const summary = {
    version: 1,
    phase: '2A.9',
    session,
    build,
    versionId,
    sourceRevision,
    artifactSha256,
    startedAt,
    finishedAt: at(),
    base,
    roomId,
    batches,
    profiles,
    reps,
    extraBatch1,
    sampleIntervalMs,
    sampleCount: samples.length,
    uniqueChecksumsByCell: Object.fromEntries(
      Object.entries(byCell).map(([key, value]) => [
        key,
        { n: value.n, checksums: [...value.checksums] },
      ]),
    ),
    finalReservation: finalStatus?.data?.reservation ?? null,
    measurementSource:
      'Cloudflare Workers Observability events, $workers.cpuTimeMs, exact run-id and scriptVersion match; integer milliseconds per Durable Object invocation.',
    notes:
      'Invocation CPU includes fresh Game construction, command setup, ticks, checksum and response. Batch 0 is setup only. No per-tick CPU is measured.',
  };
  writeFileSync(samplesPath, JSON.stringify({ samples }, null, 2) + '\n');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(
    JSON.stringify(
      { evidenceDir, session, build, versionId, samples: samples.length, roomId },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  event({ type: 'fatal', error: String(error).slice(0, 300) });
  process.exit(1);
});
