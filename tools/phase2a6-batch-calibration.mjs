#!/usr/bin/env node
// Phase 2A.6 deployed batch calibration.
//
// Creates one short staging room, shuts it down so no match is running, then
// runs fixed real-Game batches through the admin-only status route. Each URL
// carries a unique run id.
//
// CPU is taken from Cloudflare's per-invocation Workers Observability record
// (`$workers.cpuTimeMs`, integer milliseconds). The exact run ids are exported
// and joined by tools/phase2a6-analyse.mjs. Workers Observability can omit
// individual invocation records on the Free plan; omitted runs are reported and
// never imputed.
//
// A paced run is recommended so the platform has time to ingest each event:
//   MP_CALIBRATION_REPS=10 MP_SAMPLE_INTERVAL_MS=500 \
//     node tools/phase2a6-batch-calibration.mjs
//
// Optional live-tail cross-check:
//   MP_TAIL_FILE=staging-evidence/phase2a6-.../tail.jsonl \
//     node tools/phase2a6-batch-calibration.mjs
//
// No token is printed or written to evidence.

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
const evidenceDir = join('staging-evidence', `phase2a6-calibration-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const requestsPath = join(evidenceDir, 'requests.jsonl');
const samplesPath = join(evidenceDir, 'samples.json');
const summaryPath = join(evidenceDir, 'summary.json');
const tailFile = process.env.MP_TAIL_FILE ?? '';

const batches = [0, 1, 5, 10, 20, 50, 100];
const profiles = ['baseline', 'stress'];
const reps = Number(process.env.MP_CALIBRATION_REPS ?? 5);
const versionId = process.env.MP_VERSION_ID ?? null;
const sampleIntervalMs = Number(process.env.MP_SAMPLE_INTERVAL_MS ?? 50);
if (!Number.isInteger(reps) || reps < 1 || reps > 10) {
  console.error('MP_CALIBRATION_REPS must be an integer from 1 to 10.');
  process.exit(2);
}
if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 0 || sampleIntervalMs > 2000) {
  console.error('MP_SAMPLE_INTERVAL_MS must be an integer from 0 to 2000.');
  process.exit(2);
}

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

function parseTail(raw) {
  const parts = raw.split(/\n(?=\{\n)/).filter(Boolean);
  return parts
    .map((part) => {
      try {
        return JSON.parse(part);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function runIdFromUrl(value) {
  try {
    return new URL(value).searchParams.get('run');
  } catch {
    return null;
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}

function linearFit(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((total, point) => total + point.x, 0);
  const sumY = points.reduce((total, point) => total + point.y, 0);
  const sumXY = points.reduce((total, point) => total + point.x * point.y, 0);
  const sumXX = points.reduce((total, point) => total + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const residuals = points.map((point) => point.y - (intercept + slope * point.x));
  const mean = sumY / n;
  const ssTotal = points.reduce((total, point) => total + (point.y - mean) ** 2, 0);
  const ssResidual = residuals.reduce((total, value) => total + value * value, 0);
  return {
    slope,
    intercept,
    r2: ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal,
    maxAbsResidual: Math.max(...residuals.map((value) => Math.abs(value))),
    residualMean: residuals.reduce((total, value) => total + value, 0) / n,
    n,
  };
}

function summarise(samples) {
  const profilesOut = {};
  for (const profile of profiles) {
    const rows = samples.filter((sample) => sample.profile === profile);
    const points = rows.map((sample) => ({ x: sample.batch, y: sample.cpuTimeMs }));
    const fit = linearFit(points);
    const byBatch = {};
    for (const batch of batches) {
      const values = rows.filter((row) => row.batch === batch).map((row) => row.cpuTimeMs);
      byBatch[batch] = {
        n: values.length,
        values,
        meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        maxMs: values.length ? Math.max(...values) : null,
      };
    }
    profilesOut[profile] = {
      samples: rows.length,
      byBatch,
      linearFit: fit,
      estimatedMarginalMsPerTick: fit?.slope ?? null,
      estimatedFixedOverheadMs: fit?.intercept ?? null,
    };
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    base,
    versionId,
    batches,
    profiles,
    reps,
    sampleCount: samples.length,
    byProfile: profilesOut,
    resolution: 'Workers Observability / wrangler tail CPU is integer milliseconds per invocation; platform sampling can omit records.',
    notes:
      'Derived marginal cost is a linear fit of invocation CPU against batch size. It is not an individual tick measurement and cannot establish a per-tick maximum. Only exact run-id matches are used by the analysis step.',
  };
}

async function main() {
  const healthResponse = await fetch(`${base}/api/multiplayer/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.build, 'phase2a6-staging', 'staging build marker');
  assert.equal(health.onlineEnabled, true);
  event({ type: 'health', build: health.build, protocol: health.protocol, versionId });

  const roomId = `phase2a6-cal-${Date.now().toString(36)}`;
  const created = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs: 10_000,
  });
  assert.equal(created.status, 200, `create: ${JSON.stringify(created.data)}`);
  event({ type: 'room-created', roomId });

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
      ['baseline', 101, 'invalid-calibration'],
    ]) {
      const invalid = await api(calibrationPath(roomId, profile, batch, 'invalid'));
      assert.equal(invalid.status, 400, `invalid ${profile}/${batch}`);
      assert.equal(invalid.data.code, expectedCode);
      event({ type: 'invalid-calibration', profile, batch, status: invalid.status, code: invalid.data.code });
    }

    const plain = await api(roomPath(roomId, '/status'));
    assert.equal(plain.status, 200);
    assert.equal(plain.data.calibration, undefined);
    event({ type: 'plain-status', status: plain.status, hasCalibration: false });

    // Warm the Durable Object and its closed-room metadata load. Excluded from
    // the sample fit; its CPU is recorded only in the tail if present.
    for (let index = 0; index < 2; index++) {
      const warm = await api(calibrationPath(roomId, 'baseline', 0, `warmup-${index}`));
      assert.equal(warm.status, 200, `warmup: ${JSON.stringify(warm.data)}`);
      assert.equal(warm.data.calibration?.completedTicks, 0);
      event({ type: 'warmup', index, run: `warmup-${index}`, bytes: warm.bytes });
      await sleep(80);
    }

    const samples = [];
    for (let rep = 0; rep < reps; rep++) {
      for (const profile of profiles) {
        for (const batch of batches) {
          const run = `p2a6-${profile}-${batch}-${rep}`;
          const response = await api(calibrationPath(roomId, profile, batch, run));
          assert.equal(response.status, 200, `calibration ${run}: ${JSON.stringify(response.data)}`);
          const calibration = response.data.calibration;
          assert.equal(calibration?.completedTicks, batch, `${run} completed ticks`);
          assert.equal(calibration?.requestedTicks, batch, `${run} requested ticks`);
          assert.equal(calibration?.runId, run);
          assert.ok(calibration?.final?.checksum);
          assert.ok(calibration?.initial?.checksum);
          samples.push({
            run,
            profile,
            batch,
            rep,
            completedTicks: calibration.completedTicks,
            checksum: calibration.final.checksum,
            initialChecksum: calibration.initial.checksum,
            finalTick: calibration.finalTick,
            units: calibration.final.units,
            projectiles: calibration.final.projectiles,
            shots: calibration.activity.shots,
            kills: calibration.activity.kills,
            commandsIssued: calibration.commandsIssued,
            responseBytes: response.bytes,
            at: at(),
            cpuTimeMs: null,
            wallTimeMs: null,
          });
          event({
            type: 'sample',
            run,
            profile,
            batch,
            completedTicks: calibration.completedTicks,
            checksum: calibration.final.checksum,
            responseBytes: response.bytes,
          });
          if (sampleIntervalMs > 0) await sleep(sampleIntervalMs);
        }
      }
    }

    // Give tail a moment to flush its final records.
    await sleep(3_000);
    let tailRows = 0;
    let durableTailRows = 0;
    let duplicateTailRuns = [];
    let tailError = null;
    if (tailFile) {
      try {
        const tail = parseTail(readFileSync(tailFile, 'utf8'));
        tailRows = tail.length;
        const byRun = new Map();
        const seen = new Map();
        for (const row of tail) {
          const run = runIdFromUrl(row.event?.request?.url ?? '');
          if (!run || !row.event.request.url.includes('calibrate=')) continue;
          // A Worker request that forwards to a Durable Object produces two
          // tail records: the stateless router and the object invocation. Only
          // the durableObject record contains the calibration CPU work.
          if (row.executionModel !== 'durableObject') continue;
          durableTailRows++;
          seen.set(run, (seen.get(run) ?? 0) + 1);
          byRun.set(run, row);
        }
        duplicateTailRuns = [...seen.entries()].filter(([, count]) => count > 1);
        for (const sample of samples) {
          const row = byRun.get(sample.run);
          if (!row) continue;
          sample.cpuTimeMs = typeof row.cpuTime === 'number' ? row.cpuTime : null;
          sample.wallTimeMs = typeof row.wallTime === 'number' ? row.wallTime : null;
          sample.outcome = row.outcome;
        }
      } catch (error) {
        tailError = String(error).slice(0, 160);
      }
    } else {
      tailError = 'MP_TAIL_FILE not set';
    }
    event({
      type: 'tail-correlation',
      tailRows,
      durableTailRows,
      duplicateTailRuns,
      matched: samples.filter((s) => s.cpuTimeMs !== null).length,
      ...(tailError ? { error: tailError } : {}),
    });

    writeFileSync(samplesPath, JSON.stringify({ samples }, null, 2) + '\n');
    const summary = summarise(samples.filter((sample) => sample.cpuTimeMs !== null));
    summary.tailFile = tailFile || null;
    summary.tailRows = tailRows;
    summary.durableTailRows = durableTailRows;
    summary.duplicateTailRuns = duplicateTailRuns;
    summary.sampleIntervalMs = sampleIntervalMs;
    summary.matchedSamples = samples.filter((sample) => sample.cpuTimeMs !== null).length;
    summary.totalSamples = samples.length;
    summary.missingTailSamples = samples
      .filter((sample) => sample.cpuTimeMs === null)
      .map((sample) => sample.run);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ evidenceDir, samples: samples.length, matched: summary.matchedSamples }, null, 2));
  } finally {
    const final = await api(roomPath(roomId, '/status')).catch(() => null);
    event({
      type: 'final-room-status',
      status: final?.status ?? null,
      closed: final?.data?.closed ?? null,
      reservation: final?.data?.reservation ?? null,
    });
  }
}

main().catch((error) => {
  event({ type: 'fatal', error: String(error).slice(0, 300) });
  process.exit(1);
});
