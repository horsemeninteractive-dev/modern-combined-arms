#!/usr/bin/env node
// Phase 2A.6 calibration analysis.
//
// Reads the calibration samples produced by tools/phase2a6-batch-calibration.mjs
// and a compact CSV exported from the Workers Observability query. Only exact
// run-id matches are used. Missing platform records are reported, never imputed.
//
//   node tools/phase2a6-analyse.mjs \
//     staging-evidence/phase2a6-calibration-<stamp>/samples.json \
//     staging-evidence/phase2a6-observability-10rep.csv \
//     staging-evidence/phase2a6-calibration-<stamp>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const samplesPath = process.argv[2];
const csvPath = process.argv[3];
const outDir = process.argv[4];
if (!samplesPath || !csvPath) {
  console.error('usage: phase2a6-analyse.mjs <samples.json> <observability.csv> [outDir]');
  process.exit(2);
}

const batches = [0, 1, 5, 10, 20, 50, 100];
const profiles = ['baseline', 'stress'];
const { samples } = JSON.parse(readFileSync(samplesPath, 'utf8'));
const csv = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
const header = csv.shift().split(',');
if (header.join(',') !== 'run,cpu_ms,wall_ms,timestamp') {
  throw new Error(`Unexpected CSV header: ${header.join(',')}`);
}
const observed = new Map();
for (const line of csv) {
  const [run, cpu, wall, timestamp] = line.split(',');
  observed.set(run, {
    cpuTimeMs: Number(cpu),
    wallTimeMs: Number(wall),
    eventTimestamp: Number(timestamp),
  });
}

const all = samples.map((sample) => {
  const row = observed.get(sample.run);
  return { ...sample, ...(row ?? {}), matched: Boolean(row) };
});
const matched = all.filter((sample) => sample.matched);

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function stddev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - m) ** 2, 0) / (values.length - 1));
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}
function fit(points) {
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
  const ssResidual = residuals.reduce((total, value) => total + value * value, 0);
  const yMean = sumY / n;
  const ssTotal = points.reduce((total, point) => total + (point.y - yMean) ** 2, 0);
  const sxx = points.reduce((total, point) => total + (point.x - sumX / n) ** 2, 0);
  const slopeStdErr = sxx === 0 ? null : Math.sqrt(ssResidual / Math.max(1, n - 2) / sxx);
  return {
    n,
    slopeMsPerTick: round(slope),
    interceptMs: round(intercept),
    r2: round(ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal),
    maxAbsResidualMs: round(Math.max(...residuals.map((value) => Math.abs(value)))),
    slopeStdErr: round(slopeStdErr),
    slopeCi95MsPerTick:
      slopeStdErr === null ? null : [round(slope - 1.96 * slopeStdErr), round(slope + 1.96 * slopeStdErr)],
  };
}
function pointsFor(rows, minBatch, maxBatch = Infinity) {
  return rows
    .filter((row) => row.batch >= minBatch && row.batch <= maxBatch)
    .map((row) => ({ x: row.batch, y: row.cpuTimeMs }));
}

const analysis = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    samplesPath,
    csvPath,
    attempt: samples.length,
    matched: matched.length,
    coveragePercent: round((matched.length / samples.length) * 100, 2),
    missingRuns: all.filter((sample) => !sample.matched).map((sample) => sample.run),
    cpuResolutionMs: 1,
    note:
      'Only exact run-id matches are used. Workers Observability on the Free plan can omit individual invocation records; missing values are not imputed.',
  },
  profiles: {},
};

for (const profile of profiles) {
  const rows = matched.filter((sample) => sample.profile === profile);
  const allRows = all.filter((sample) => sample.profile === profile);
  const byBatch = {};
  for (const batch of batches) {
    const values = rows.filter((row) => row.batch === batch).map((row) => row.cpuTimeMs);
    byBatch[batch] = {
      n: values.length,
      meanMs: round(values.length ? mean(values) : null),
      medianMs: round(median(values)),
      minMs: values.length ? Math.min(...values) : null,
      maxMs: values.length ? Math.max(...values) : null,
      p95Ms: percentile(values, 0.95),
      stddevMs: round(stddev(values)),
      cv: values.length > 1 ? round((stddev(values) ?? 0) / mean(values)) : null,
      values,
    };
  }

  const perRepSlopes = { all: [], steady20: [], steady50: [] };
  const perRepDeltas = { delta20to50: [], delta50to100: [] };
  for (let rep = 0; rep < 10; rep++) {
    const repRows = rows.filter((row) => row.rep === rep);
    for (const [key, min] of [
      ['all', 0],
      ['steady20', 20],
      ['steady50', 50],
    ]) {
      const result = fit(pointsFor(repRows, min));
      if (result) perRepSlopes[key].push(result.slopeMsPerTick);
    }
    const b20 = repRows.find((row) => row.batch === 20);
    const b50 = repRows.find((row) => row.batch === 50);
    const b100 = repRows.find((row) => row.batch === 100);
    if (b20 && b50) perRepDeltas.delta20to50.push((b50.cpuTimeMs - b20.cpuTimeMs) / 30);
    if (b50 && b100) perRepDeltas.delta50to100.push((b100.cpuTimeMs - b50.cpuTimeMs) / 50);
  }
  const summarizeReps = (values) => ({
    n: values.length,
    meanMsPerTick: round(values.length ? mean(values) : null),
    medianMsPerTick: round(median(values)),
    minMsPerTick: values.length ? round(Math.min(...values)) : null,
    maxMsPerTick: values.length ? round(Math.max(...values)) : null,
    stddevMsPerTick: round(stddev(values)),
    values: values.map((value) => round(value)),
  });

  analysis.profiles[profile] = {
    attemptedSamples: allRows.length,
    matchedSamples: rows.length,
    coveragePercent: round((rows.length / allRows.length) * 100, 2),
    missingRuns: allRows.filter((sample) => !sample.matched).map((sample) => sample.run),
    workload: profile === 'baseline' ? '16 scenario units, no added force, no commands' : '80 units (16 scenario + 64 added), 2 fixed attack-move commands',
    byBatch,
    setupControlMs: byBatch[0],
    fits: {
      allBatches: fit(pointsFor(rows, 0)),
      steady20Plus: fit(pointsFor(rows, 20)),
      steady50Plus: fit(pointsFor(rows, 50)),
    },
    perRepSlopes: {
      allBatches: summarizeReps(perRepSlopes.all),
      steady20Plus: summarizeReps(perRepSlopes.steady20),
      steady50Plus: summarizeReps(perRepSlopes.steady50),
    },
    perRepIncremental: {
      delta20to50: summarizeReps(perRepDeltas.delta20to50),
      delta50to100: summarizeReps(perRepDeltas.delta50to100),
    },
    determinism: {
      checksumVariants: [...new Set(allRows.map((row) => row.checksum))].length,
      checksumsByBatch: Object.fromEntries(
        batches.map((batch) => [batch, [...new Set(allRows.filter((row) => row.batch === batch).map((row) => row.checksum))]]),
      ),
    },
  };
}

analysis.comparison = {
  phase2a4AggregateMsPerTick: 0.547,
  note:
    'Phase 2A.4 was a real 30-minute match average. This calibration is a fresh Game per invocation and includes setup, routing and response. The stress profile is deliberately heavier than the Phase 2A.4 match and is not directly comparable.',
};

if (outDir) writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');

console.log(JSON.stringify({
  coverage: analysis.source,
  profiles: Object.fromEntries(
    profiles.map((profile) => {
      const data = analysis.profiles[profile];
      return [profile, {
        matchedSamples: data.matchedSamples,
        missingRuns: data.missingRuns,
        byBatch: Object.fromEntries(batches.map((batch) => [batch, {
          n: data.byBatch[batch].n,
          meanMs: data.byBatch[batch].meanMs,
          medianMs: data.byBatch[batch].medianMs,
          p95Ms: data.byBatch[batch].p95Ms,
          maxMs: data.byBatch[batch].maxMs,
          cv: data.byBatch[batch].cv,
        }])),
        fits: data.fits,
        perRepSlopes: data.perRepSlopes,
        perRepIncremental: data.perRepIncremental,
        determinism: data.determinism,
      }];
    }),
  ),
  out: outDir ? join(outDir, 'analysis.json') : null,
}, null, 2));
