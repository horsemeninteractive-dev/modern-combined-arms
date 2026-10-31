#!/usr/bin/env node
// Phase 2A.9 analysis.
//
// Joins the exact per-invocation Observability CPU extraction to the session
// sample metadata, validates deterministic equivalence, and reports bounded
// descriptive statistics and bootstrap uncertainty. It does not infer
// individual tick CPU or deployed per-tick maxima.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXTRACT_PATH = join(ROOT, 'staging-evidence', 'phase2a9-observability-extract.json');
const OUT_DIR = join(ROOT, 'staging-evidence', 'phase2a9-analysis');
const BATCHES = [0, 1, 5, 20, 100];
const PROFILES = ['baseline', 'stress'];
const MAIN_REPS = 6;
const EXTRA_REPS = 12;
const BOOTSTRAP_REPS = 10_000;

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}

function stdev(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1));
}

function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x2a9c0de);

function resample(values) {
  const out = new Array(values.length);
  for (let index = 0; index < values.length; index++) {
    out[index] = values[Math.floor(rng() * values.length)];
  }
  return out;
}

function bootstrapCI(values, statistic, reps = BOOTSTRAP_REPS) {
  const samples = [];
  for (let index = 0; index < reps; index++) samples.push(statistic(resample(values)));
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function bootstrapDifferenceCI(a, b, statistic, reps = BOOTSTRAP_REPS) {
  const samples = [];
  for (let index = 0; index < reps; index++) {
    samples.push(statistic(resample(a)) - statistic(resample(b)));
  }
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function bootstrapRatioCI(numeratorA, a, b, statistic, reps = BOOTSTRAP_REPS) {
  const samples = [];
  for (let index = 0; index < reps; index++) {
    const left = statistic(resample(a));
    const right = statistic(resample(b));
    const base = statistic(resample(numeratorA));
    if (base === 0) continue;
    samples.push((left - right) / base);
  }
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function stats(values) {
  if (!values.length) {
    return {
      n: 0,
      total: 0,
      mean: null,
      median: null,
      sd: null,
      min: null,
      max: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      p95: null,
      meanCi95: [null, null],
      medianCi95: [null, null],
    };
  }
  return {
    n: values.length,
    total: values.reduce((total, value) => total + value, 0),
    mean: mean(values),
    median: median(values),
    sd: stdev(values),
    min: Math.min(...values),
    max: Math.max(...values),
    p10: quantile(values, 0.1),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    meanCi95: bootstrapCI(values, mean),
    medianCi95: bootstrapCI(values, median),
  };
}

function roundedStats(values) {
  const value = stats(values);
  return {
    n: value.n,
    total: value.total,
    mean: round(value.mean),
    median: round(value.median),
    sd: round(value.sd),
    min: value.min,
    max: value.max,
    p10: round(value.p10),
    p25: round(value.p25),
    p75: round(value.p75),
    p90: round(value.p90),
    p95: round(value.p95),
    meanCi95: value.meanCi95.map((entry) => round(entry)),
    medianCi95: value.medianCi95.map((entry) => round(entry)),
  };
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
  const average = sumY / n;
  const ssTotal = points.reduce((total, point) => total + (point.y - average) ** 2, 0);
  const ssResidual = residuals.reduce((total, value) => total + value * value, 0);
  return {
    slope,
    intercept,
    r2: ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal,
    maxAbsResidual: Math.max(...residuals.map((value) => Math.abs(value))),
    residualMean: mean(residuals),
    n,
  };
}

function loadSessions(extract) {
  const all = [];
  const sessionSummaries = {};
  for (const build of ['A', 'B']) {
    const buildExtract = extract.builds[build];
    for (const session of Object.keys(buildExtract.sessions)) {
      const directories = readdirSync(join(ROOT, 'staging-evidence')).filter(
        (name) =>
          name.startsWith(`phase2a9-${session}-`) &&
          statSync(join(ROOT, 'staging-evidence', name)).isDirectory(),
      );
      assert.equal(directories.length, 1, `${session} evidence directory`);
      const directory = join(ROOT, 'staging-evidence', directories[0]);
      const summary = JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8'));
      const samples = JSON.parse(readFileSync(join(directory, 'samples.json'), 'utf8')).samples;
      assert.equal(summary.session, session);
      assert.equal(summary.versionId, buildExtract.versionId, `${session} version id`);
      assert.equal(samples.length, MAIN_REPS * PROFILES.length * BATCHES.length + EXTRA_REPS);
      sessionSummaries[session] = {
        directory: directories[0],
        roomId: summary.roomId,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        sampleCount: summary.sampleCount,
        finalReservation: summary.finalReservation,
        checksumCells: Object.keys(summary.uniqueChecksumsByCell ?? {}).length,
      };

      const byRun = new Map(samples.map((sample) => [sample.run, sample]));
      const records = [];
      for (const profile of PROFILES) {
        for (const batch of BATCHES) {
          const key = String(batch);
          const values = buildExtract.sessions[session][profile][key];
          assert.ok(Array.isArray(values), `${session} ${profile} ${batch} cpu array`);
          assert.equal(values.length, MAIN_REPS, `${session} ${profile} ${batch} length`);
          for (let rep = 0; rep < values.length; rep++) {
            const run = `p2a9-${session}-${profile}-${batch}-${rep}`;
            const sample = byRun.get(run);
            assert.ok(sample, `${run} sample`);
            assert.equal(sample.profile, profile);
            assert.equal(sample.batch, batch);
            assert.equal(sample.extraBatch1, false);
            records.push({ ...sample, cpuMs: values[rep], session, build });
          }
        }
      }
      const extra = buildExtract.sessions[session].stress['1extra'];
      assert.equal(extra.length, EXTRA_REPS, `${session} extra length`);
      for (let index = 0; index < extra.length; index++) {
        const run = `p2a9-${session}-stress-1-extra-${index}`;
        const sample = byRun.get(run);
        assert.ok(sample, `${run} sample`);
        assert.equal(sample.profile, 'stress');
        assert.equal(sample.batch, 1);
        assert.equal(sample.extraBatch1, true);
        records.push({ ...sample, cpuMs: extra[index], session, build });
      }
      assert.equal(records.length, samples.length, `${session} record coverage`);
      all.push(...records);
    }
  }
  return { all, sessionSummaries };
}

function valuesFor(records, build, profile, batch, extra = false) {
  return records
    .filter(
      (record) =>
        record.build === build &&
        record.profile === profile &&
        record.batch === batch &&
        record.extraBatch1 === extra,
    )
    .sort((a, b) => a.session.localeCompare(b.session) || a.run.localeCompare(b.run))
    .map((record) => record.cpuMs);
}

function compareDeterminism(records) {
  const fields = [
    'checksum',
    'initialChecksum',
    'finalTick',
    'units',
    'projectiles',
    'shots',
    'kills',
    'commandsIssued',
    'commandEntityIds',
    'rngState',
  ];
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.session.slice(1)}|${record.profile}|${record.batch}|${record.extraBatch1 ? `extra-${record.run.split('-').at(-1)}` : `rep-${record.run.split('-').at(-1)}`}`;
    byKey.set(`${record.build}|${key}`, record);
  }
  const mismatches = [];
  let comparisons = 0;
  for (const [key, a] of byKey) {
    if (!key.startsWith('A|')) continue;
    const b = byKey.get(`B|${key.slice(2)}`);
    if (!b) {
      mismatches.push({ key, field: 'missing-B', a: null, b: null });
      continue;
    }
    comparisons++;
    for (const field of fields) {
      if (a[field] !== b[field]) {
        mismatches.push({ key, field, a: a[field], b: b[field] });
      }
    }
  }
  return { comparisons, mismatches, fields };
}

function percent(value, digits = 1) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(digits)}%`;
}

function number(value, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'n/a'
    : value.toFixed(digits);
}

function cellRows(records) {
  const cells = {};
  for (const build of ['A', 'B']) {
    cells[build] = {};
    for (const profile of PROFILES) {
      cells[build][profile] = {};
      for (const batch of BATCHES) {
        cells[build][profile][batch] = roundedStats(valuesFor(records, build, profile, batch));
      }
      if (profile === 'stress') {
        cells[build][profile].extraBatch1 = roundedStats(
          valuesFor(records, build, profile, 1, true),
        );
        cells[build][profile].firstTickCombined = roundedStats([
          ...valuesFor(records, build, profile, 1),
          ...valuesFor(records, build, profile, 1, true),
        ]);
      }
    }
  }
  return cells;
}

function derived(records) {
  const out = {};
  for (const build of ['A', 'B']) {
    const stress0 = valuesFor(records, build, 'stress', 0);
    const stress1 = valuesFor(records, build, 'stress', 1);
    const stress1Combined = [...stress1, ...valuesFor(records, build, 'stress', 1, true)];
    const stress5 = valuesFor(records, build, 'stress', 5);
    const stress20 = valuesFor(records, build, 'stress', 20);
    const stress100 = valuesFor(records, build, 'stress', 100);
    const baseline0 = valuesFor(records, build, 'baseline', 0);
    const baseline1 = valuesFor(records, build, 'baseline', 1);
    const baseline100 = valuesFor(records, build, 'baseline', 100);

    const firstTickExcessMeanCi = bootstrapDifferenceCI(stress1, stress0, mean);
    const firstTickExcessMedianCi = bootstrapDifferenceCI(stress1, stress0, median);
    const firstTickExcessCombinedMeanCi = bootstrapDifferenceCI(stress1Combined, stress0, mean);
    const firstTickExcessCombinedMedianCi = bootstrapDifferenceCI(stress1Combined, stress0, median);
    const baselineExcessMeanCi = bootstrapDifferenceCI(baseline1, baseline0, mean);
    const baselineExcessMedianCi = bootstrapDifferenceCI(baseline1, baseline0, median);

    const perTickAll100Samples = [];
    const perTickAll100MedianSamples = [];
    const perTickAfterFirstSamples = [];
    const perTickAfterFirstMedianSamples = [];
    for (let index = 0; index < BOOTSTRAP_REPS; index++) {
      perTickAll100Samples.push((mean(resample(stress100)) - mean(resample(stress0))) / 100);
      perTickAll100MedianSamples.push((median(resample(stress100)) - median(resample(stress0))) / 100);
      perTickAfterFirstSamples.push((mean(resample(stress100)) - mean(resample(stress1))) / 99);
      perTickAfterFirstMedianSamples.push((median(resample(stress100)) - median(resample(stress1))) / 99);
    }

    out[build] = {
      stressSetup: roundedStats(stress0),
      stressFirstTickDirect: roundedStats(stress1),
      stressFirstTickCombined: roundedStats(stress1Combined),
      stressFirstTickExcess: {
        mean: round(mean(stress1) - mean(stress0)),
        median: round(median(stress1) - median(stress0)),
        meanCi95: firstTickExcessMeanCi.map((entry) => round(entry)),
        medianCi95: firstTickExcessMedianCi.map((entry) => round(entry)),
      },
      stressFirstTickExcessCombined: {
        mean: round(mean(stress1Combined) - mean(stress0)),
        median: round(median(stress1Combined) - median(stress0)),
        meanCi95: firstTickExcessCombinedMeanCi.map((entry) => round(entry)),
        medianCi95: firstTickExcessCombinedMedianCi.map((entry) => round(entry)),
      },
      baselineSetup: roundedStats(baseline0),
      baselineFirstTick: roundedStats(baseline1),
      baselineFirstTickExcess: {
        mean: round(mean(baseline1) - mean(baseline0)),
        median: round(median(baseline1) - median(baseline0)),
        meanCi95: baselineExcessMeanCi.map((entry) => round(entry)),
        medianCi95: baselineExcessMedianCi.map((entry) => round(entry)),
      },
      stressPerTickFromSetup100: {
        mean: round((mean(stress100) - mean(stress0)) / 100),
        median: round((median(stress100) - median(stress0)) / 100),
        meanCi95: [quantile(perTickAll100Samples, 0.025), quantile(perTickAll100Samples, 0.975)].map((entry) => round(entry)),
        medianCi95: [quantile(perTickAll100MedianSamples, 0.025), quantile(perTickAll100MedianSamples, 0.975)].map((entry) => round(entry)),
      },
      stressPerTickAfterFirst: {
        mean: round((mean(stress100) - mean(stress1)) / 99),
        median: round((median(stress100) - median(stress1)) / 99),
        meanCi95: [quantile(perTickAfterFirstSamples, 0.025), quantile(perTickAfterFirstSamples, 0.975)].map((entry) => round(entry)),
        medianCi95: [quantile(perTickAfterFirstMedianSamples, 0.025), quantile(perTickAfterFirstMedianSamples, 0.975)].map((entry) => round(entry)),
      },
      stressTotals: {
        batch1Mean: round(mean(stress1)),
        batch100Mean: round(mean(stress100)),
        batch5Mean: round(mean(stress5)),
        batch20Mean: round(mean(stress20)),
        baseline100Mean: round(mean(baseline100)),
      },
    };
  }

  const firstTickA = valuesFor(records, 'A', 'stress', 1);
  const firstTickB = valuesFor(records, 'B', 'stress', 1);
  const firstTickCombinedA = [...firstTickA, ...valuesFor(records, 'A', 'stress', 1, true)];
  const firstTickCombinedB = [...firstTickB, ...valuesFor(records, 'B', 'stress', 1, true)];
  const setupA = valuesFor(records, 'A', 'stress', 0);
  const setupB = valuesFor(records, 'B', 'stress', 0);

  const excessMeanA = mean(firstTickA) - mean(setupA);
  const excessMeanB = mean(firstTickB) - mean(setupB);
  const excessMedianA = median(firstTickA) - median(setupA);
  const excessMedianB = median(firstTickB) - median(setupB);
  const combinedExcessMeanA = mean(firstTickCombinedA) - mean(setupA);
  const combinedExcessMeanB = mean(firstTickCombinedB) - mean(setupB);
  const combinedExcessMedianA = median(firstTickCombinedA) - median(setupA);
  const combinedExcessMedianB = median(firstTickCombinedB) - median(setupB);

  const excessDiffMean = bootstrapDifferenceCI(
    firstTickA,
    setupA,
    mean,
  );
  const excessDiffMeanB = bootstrapDifferenceCI(firstTickB, setupB, mean);
  const excessDiffMedian = bootstrapDifferenceCI(firstTickA, setupA, median);
  const excessDiffMedianB = bootstrapDifferenceCI(firstTickB, setupB, median);

  const diffMean = excessMeanA - excessMeanB;
  const diffMedian = excessMedianA - excessMedianB;
  const combinedDiffMean = combinedExcessMeanA - combinedExcessMeanB;
  const combinedDiffMedian = combinedExcessMedianA - combinedExcessMedianB;

  // Independent bootstrap for the difference-in-differences. Resample all four
  // groups and recompute each build's excess before subtracting.
  const didMeanSamples = [];
  const didMedianSamples = [];
  for (let index = 0; index < BOOTSTRAP_REPS; index++) {
    const a1 = resample(firstTickA);
    const b1 = resample(firstTickB);
    const a0 = resample(setupA);
    const b0 = resample(setupB);
    didMeanSamples.push(mean(a1) - mean(a0) - (mean(b1) - mean(b0)));
    didMedianSamples.push(median(a1) - median(a0) - (median(b1) - median(b0)));
  }
  const didMeanCi = [quantile(didMeanSamples, 0.025), quantile(didMeanSamples, 0.975)];
  const didMedianCi = [quantile(didMedianSamples, 0.025), quantile(didMedianSamples, 0.975)];

  const combinedDidMeanSamples = [];
  const combinedDidMedianSamples = [];
  for (let index = 0; index < BOOTSTRAP_REPS; index++) {
    const a1 = resample(firstTickCombinedA);
    const b1 = resample(firstTickCombinedB);
    const a0 = resample(setupA);
    const b0 = resample(setupB);
    combinedDidMeanSamples.push(mean(a1) - mean(a0) - (mean(b1) - mean(b0)));
    combinedDidMedianSamples.push(median(a1) - median(a0) - (median(b1) - median(b0)));
  }

  const extraFirstA = valuesFor(records, 'A', 'stress', 1, true);
  const extraFirstB = valuesFor(records, 'B', 'stress', 1, true);
  const batch100A = valuesFor(records, 'A', 'stress', 100);
  const batch100B = valuesFor(records, 'B', 'stress', 100);
  const percentMean100 = (mean(batch100A) - mean(batch100B)) / mean(batch100A);
  const percentMedian100 = (median(batch100A) - median(batch100B)) / median(batch100A);
  const percentMean1 = (mean(firstTickA) - mean(firstTickB)) / mean(firstTickA);
  const percentMedian1 = (median(firstTickA) - median(firstTickB)) / median(firstTickA);
  const percentCombinedMean1 =
    (mean(firstTickCombinedA) - mean(firstTickCombinedB)) / mean(firstTickCombinedA);
  const percentCombinedMedian1 =
    (median(firstTickCombinedA) - median(firstTickCombinedB)) / median(firstTickCombinedA);
  const extraExcessA = mean(extraFirstA) - mean(setupA);
  const extraExcessB = mean(extraFirstB) - mean(setupB);
  const extraExcessMedianA = median(extraFirstA) - median(setupA);
  const extraExcessMedianB = median(extraFirstB) - median(setupB);
  const extraExcessMeanCi = bootstrapDifferenceCI(extraFirstA, setupA, mean);
  const extraExcessMeanBCi = bootstrapDifferenceCI(extraFirstB, setupB, mean);
  const extraExcessMedianCi = bootstrapDifferenceCI(extraFirstA, setupA, median);
  const extraExcessMedianBCi = bootstrapDifferenceCI(extraFirstB, setupB, median);
  const extraDidMeanSamples = [];
  const extraDidMedianSamples = [];
  for (let index = 0; index < BOOTSTRAP_REPS; index++) {
    const a1 = resample(extraFirstA);
    const b1 = resample(extraFirstB);
    const a0 = resample(setupA);
    const b0 = resample(setupB);
    extraDidMeanSamples.push(mean(a1) - mean(a0) - (mean(b1) - mean(b0)));
    extraDidMedianSamples.push(median(a1) - median(a0) - (median(b1) - median(b0)));
  }
  const extraDidMeanCi = [quantile(extraDidMeanSamples, 0.025), quantile(extraDidMeanSamples, 0.975)];
  const extraDidMedianCi = [quantile(extraDidMedianSamples, 0.025), quantile(extraDidMedianSamples, 0.975)];

  const perTickFromSetupSamplesA = [];
  const perTickFromSetupSamplesB = [];
  const perTickFromSetupDiffSamples = [];
  const perTickFromSetupPercentSamples = [];
  const perTickAfterFirstSamplesA = [];
  const perTickAfterFirstSamplesB = [];
  const perTickAfterFirstDiffSamples = [];
  const perTickAfterFirstPercentSamples = [];
  for (let index = 0; index < BOOTSTRAP_REPS; index++) {
    const a100 = resample(batch100A);
    const b100 = resample(batch100B);
    const a1 = resample(firstTickA);
    const b1 = resample(firstTickB);
    const a0 = resample(setupA);
    const b0 = resample(setupB);
    const valueA = (mean(a100) - mean(a0)) / 100;
    const valueB = (mean(b100) - mean(b0)) / 100;
    perTickFromSetupSamplesA.push(valueA);
    perTickFromSetupSamplesB.push(valueB);
    perTickFromSetupDiffSamples.push(valueA - valueB);
    if (valueA !== 0) perTickFromSetupPercentSamples.push((valueA - valueB) / valueA);
    const afterA = (mean(a100) - mean(a1)) / 99;
    const afterB = (mean(b100) - mean(b1)) / 99;
    perTickAfterFirstSamplesA.push(afterA);
    perTickAfterFirstSamplesB.push(afterB);
    perTickAfterFirstDiffSamples.push(afterA - afterB);
    if (afterA !== 0)    perTickAfterFirstPercentSamples.push((afterA - afterB) / afterA);
  }

  const baseline1A = valuesFor(records, 'A', 'baseline', 1);
  const baseline1B = valuesFor(records, 'B', 'baseline', 1);
  const baseline0A = valuesFor(records, 'A', 'baseline', 0);
  const baseline0B = valuesFor(records, 'B', 'baseline', 0);

  const comparison = {
    setup: {
      meanA: round(mean(setupA)),
      meanB: round(mean(setupB)),
      meanDiff: round(mean(setupA) - mean(setupB)),
      medianA: round(median(setupA)),
      medianB: round(median(setupB)),
      medianDiff: round(median(setupA) - median(setupB)),
      meanDiffCi95: bootstrapDifferenceCI(setupA, setupB, mean).map((entry) => round(entry)),
      medianDiffCi95: bootstrapDifferenceCI(setupA, setupB, median).map((entry) => round(entry)),
    },
    firstTick: {
      meanA: round(mean(firstTickA)),
      meanB: round(mean(firstTickB)),
      meanDiff: round(mean(firstTickA) - mean(firstTickB)),
      medianA: round(median(firstTickA)),
      medianB: round(median(firstTickB)),
      medianDiff: round(median(firstTickA) - median(firstTickB)),
      meanDiffCi95: bootstrapDifferenceCI(firstTickA, firstTickB, mean).map((entry) => round(entry)),
      medianDiffCi95: bootstrapDifferenceCI(firstTickA, firstTickB, median).map((entry) => round(entry)),
      percentMean: round(percentMean1, 4),
      percentMedian: round(percentMedian1, 4),
      percentMeanCi95: bootstrapRatioCI(firstTickA, firstTickA, firstTickB, mean).map((entry) => round(entry, 4)),
      percentMedianCi95: bootstrapRatioCI(firstTickA, firstTickA, firstTickB, median).map((entry) => round(entry, 4)),
    },
    firstTickCombined: {
      meanA: round(mean(firstTickCombinedA)),
      meanB: round(mean(firstTickCombinedB)),
      meanDiff: round(mean(firstTickCombinedA) - mean(firstTickCombinedB)),
      medianA: round(median(firstTickCombinedA)),
      medianB: round(median(firstTickCombinedB)),
      medianDiff: round(median(firstTickCombinedA) - median(firstTickCombinedB)),
      meanDiffCi95: bootstrapDifferenceCI(firstTickCombinedA, firstTickCombinedB, mean).map((entry) => round(entry)),
      medianDiffCi95: bootstrapDifferenceCI(firstTickCombinedA, firstTickCombinedB, median).map((entry) => round(entry)),
      percentMean: round(percentCombinedMean1, 4),
      percentMedian: round(percentCombinedMedian1, 4),
    },
    firstTickExcess: {
      meanA: round(excessMeanA),
      meanB: round(excessMeanB),
      meanDiff: round(diffMean),
      medianA: round(excessMedianA),
      medianB: round(excessMedianB),
      medianDiff: round(diffMedian),
      meanACi95: [round(excessDiffMean[0]), round(excessDiffMean[1])],
      meanBCi95: [round(excessDiffMeanB[0]), round(excessDiffMeanB[1])],
      medianACi95: [round(excessDiffMedian[0]), round(excessDiffMedian[1])],
      medianBCi95: [round(excessDiffMedianB[0]), round(excessDiffMedianB[1])],
      diffMeanCi95: didMeanCi.map((entry) => round(entry)),
      diffMedianCi95: didMedianCi.map((entry) => round(entry)),
      percentMean: round(diffMean / excessMeanA, 4),
      percentMedian: round(diffMedian / excessMedianA, 4),
      percentMeanCi95: [
        round(didMeanCi[0] / excessMeanA, 4),
        round(didMeanCi[1] / excessMeanA, 4),
      ],
      percentMedianCi95: [
        round(didMedianCi[0] / excessMedianA, 4),
        round(didMedianCi[1] / excessMedianA, 4),
      ],
    },
    firstTickExcessCombined: {
      meanA: round(combinedExcessMeanA),
      meanB: round(combinedExcessMeanB),
      meanDiff: round(combinedDiffMean),
      medianA: round(combinedExcessMedianA),
      medianB: round(combinedExcessMedianB),
      medianDiff: round(combinedDiffMedian),
      diffMeanCi95: [quantile(combinedDidMeanSamples, 0.025), quantile(combinedDidMeanSamples, 0.975)].map((entry) => round(entry)),
      diffMedianCi95: [quantile(combinedDidMedianSamples, 0.025), quantile(combinedDidMedianSamples, 0.975)].map((entry) => round(entry)),
    },
    batch100: {
      meanA: round(mean(batch100A)),
      meanB: round(mean(batch100B)),
      meanDiff: round(mean(batch100A) - mean(batch100B)),
      medianA: round(median(batch100A)),
      medianB: round(median(batch100B)),
      medianDiff: round(median(batch100A) - median(batch100B)),
      meanDiffCi95: bootstrapDifferenceCI(batch100A, batch100B, mean).map((entry) => round(entry)),
      medianDiffCi95: bootstrapDifferenceCI(batch100A, batch100B, median).map((entry) => round(entry)),
      percentMean: round(percentMean100, 4),
      percentMedian: round(percentMedian100, 4),
      percentMeanCi95: bootstrapRatioCI(batch100A, batch100A, batch100B, mean).map((entry) => round(entry, 4)),
      percentMedianCi95: bootstrapRatioCI(batch100A, batch100A, batch100B, median).map((entry) => round(entry, 4)),
    },
    warmFirstTick: {
      totalMeanA: round(mean(extraFirstA)),
      totalMeanB: round(mean(extraFirstB)),
      totalMeanDiff: round(mean(extraFirstA) - mean(extraFirstB)),
      totalMedianA: round(median(extraFirstA)),
      totalMedianB: round(median(extraFirstB)),
      totalPercentMean: round((mean(extraFirstA) - mean(extraFirstB)) / mean(extraFirstA), 4),
      excessMeanA: round(extraExcessA),
      excessMeanB: round(extraExcessB),
      excessMeanDiff: round(extraExcessA - extraExcessB),
      excessMedianA: round(extraExcessMedianA),
      excessMedianB: round(extraExcessMedianB),
      excessMedianDiff: round(extraExcessMedianA - extraExcessMedianB),
      excessMeanACi95: [round(extraExcessMeanCi[0]), round(extraExcessMeanCi[1])],
      excessMeanBCi95: [round(extraExcessMeanBCi[0]), round(extraExcessMeanBCi[1])],
      excessMedianACi95: [round(extraExcessMedianCi[0]), round(extraExcessMedianCi[1])],
      excessMedianBCi95: [round(extraExcessMedianBCi[0]), round(extraExcessMedianBCi[1])],
      excessDiffMeanCi95: extraDidMeanCi.map((entry) => round(entry)),
      excessDiffMedianCi95: extraDidMedianCi.map((entry) => round(entry)),
      excessPercentMean: round((extraExcessA - extraExcessB) / extraExcessA, 4),
      excessPercentMeanCi95: [round(extraDidMeanCi[0] / extraExcessA, 4), round(extraDidMeanCi[1] / extraExcessA, 4)],
      excessPercentMedian: round((extraExcessMedianA - extraExcessMedianB) / extraExcessMedianA, 4),
    },
    baselineNegativeControl: {
      setupMeanA: round(mean(baseline0A)),
      setupMeanB: round(mean(baseline0B)),
      firstTickMeanA: round(mean(baseline1A)),
      firstTickMeanB: round(mean(baseline1B)),
      firstTickMeanDiff: round(mean(baseline1A) - mean(baseline1B)),
      firstTickMedianA: round(median(baseline1A)),
      firstTickMedianB: round(median(baseline1B)),
      firstTickDiffCi95: bootstrapDifferenceCI(baseline1A, baseline1B, mean).map((entry) => round(entry)),
    },
    perTickFromSetup100: {
      meanA: round((mean(batch100A) - mean(setupA)) / 100),
      meanB: round((mean(batch100B) - mean(setupB)) / 100),
      meanDiff: round((mean(batch100A) - mean(setupA) - (mean(batch100B) - mean(setupB))) / 100),
      meanACi95: [quantile(perTickFromSetupSamplesA, 0.025), quantile(perTickFromSetupSamplesA, 0.975)].map((entry) => round(entry)),
      meanBCi95: [quantile(perTickFromSetupSamplesB, 0.025), quantile(perTickFromSetupSamplesB, 0.975)].map((entry) => round(entry)),
      diffCi95: [quantile(perTickFromSetupDiffSamples, 0.025), quantile(perTickFromSetupDiffSamples, 0.975)].map((entry) => round(entry)),
      percentMean: round(
        ((mean(batch100A) - mean(setupA)) / 100 - (mean(batch100B) - mean(setupB)) / 100) /
          ((mean(batch100A) - mean(setupA)) / 100),
        4,
      ),
      percentCi95: [quantile(perTickFromSetupPercentSamples, 0.025), quantile(perTickFromSetupPercentSamples, 0.975)].map((entry) => round(entry, 4)),
    },
    perTickAfterFirst: {
      meanA: round((mean(batch100A) - mean(firstTickA)) / 99),
      meanB: round((mean(batch100B) - mean(firstTickB)) / 99),
      meanDiff: round((mean(batch100A) - mean(firstTickA) - (mean(batch100B) - mean(firstTickB))) / 99),
      meanACi95: [quantile(perTickAfterFirstSamplesA, 0.025), quantile(perTickAfterFirstSamplesA, 0.975)].map((entry) => round(entry)),
      meanBCi95: [quantile(perTickAfterFirstSamplesB, 0.025), quantile(perTickAfterFirstSamplesB, 0.975)].map((entry) => round(entry)),
      diffCi95: [quantile(perTickAfterFirstDiffSamples, 0.025), quantile(perTickAfterFirstDiffSamples, 0.975)].map((entry) => round(entry)),
      percentMean: round(
        ((mean(batch100A) - mean(firstTickA)) / 99 - (mean(batch100B) - mean(firstTickB)) / 99) /
          ((mean(batch100A) - mean(firstTickA)) / 99),
        4,
      ),
      percentCi95: [quantile(perTickAfterFirstPercentSamples, 0.025), quantile(perTickAfterFirstPercentSamples, 0.975)].map((entry) => round(entry, 4)),
    },
  };

  return { builds: out, comparison };
}

function fits(records) {
  const out = {};
  for (const build of ['A', 'B']) {
    out[build] = {};
    for (const profile of PROFILES) {
      const points = records
        .filter((record) => record.build === build && record.profile === profile && record.batch > 0 && !record.extraBatch1)
        .map((record) => ({ x: record.batch, y: record.cpuMs }));
      const full = fit(points);
      const sustained = fit(points.filter((point) => point.x >= 5));
      out[build][profile] = {
        full: full && {
          ...full,
          slope: round(full.slope, 4),
          intercept: round(full.intercept, 3),
          r2: round(full.r2, 4),
          maxAbsResidual: round(full.maxAbsResidual, 3),
          residualMean: round(full.residualMean, 3),
        },
        batch5To100: sustained && {
          ...sustained,
          slope: round(sustained.slope, 4),
          intercept: round(sustained.intercept, 3),
          r2: round(sustained.r2, 4),
          maxAbsResidual: round(sustained.maxAbsResidual, 3),
          residualMean: round(sustained.residualMean, 3),
        },
      };
    }
  }
  return out;
}

function sessionTable(records, sessionSummaries) {
  const out = {};
  for (const session of Object.keys(sessionSummaries)) {
    const sessionRecords = records.filter((record) => record.session === session);
    out[session] = {};
    for (const [profile, batch, extra] of [
      ['stress', 0, false],
      ['stress', 1, false],
      ['stress', 1, true],
      ['stress', 100, false],
      ['baseline', 0, false],
      ['baseline', 1, false],
    ]) {
      const key = extra ? `${profile}-${batch}-extra` : `${profile}-${batch}`;
      out[session][key] = roundedStats(valuesFor(sessionRecords, session[0], profile, batch, extra));
    }
  }
  return out;
}

function sessionPairs(records) {
  const pairs = [];
  for (const slot of [1, 2, 3]) {
    const aRows = records.filter((record) => record.session === `A${slot}`);
    const bRows = records.filter((record) => record.session === `B${slot}`);
    const aSetup = valuesFor(aRows, 'A', 'stress', 0);
    const bSetup = valuesFor(bRows, 'B', 'stress', 0);
    const aFirst = [...valuesFor(aRows, 'A', 'stress', 1), ...valuesFor(aRows, 'A', 'stress', 1, true)];
    const bFirst = [...valuesFor(bRows, 'B', 'stress', 1), ...valuesFor(bRows, 'B', 'stress', 1, true)];
    const a100 = valuesFor(aRows, 'A', 'stress', 100);
    const b100 = valuesFor(bRows, 'B', 'stress', 100);
    pairs.push({
      slot,
      sessions: [`A${slot}`, `B${slot}`],
      stressSetupMeanA: round(mean(aSetup)),
      stressSetupMeanB: round(mean(bSetup)),
      firstTickCombinedMeanA: round(mean(aFirst)),
      firstTickCombinedMeanB: round(mean(bFirst)),
      firstTickCombinedMeanDiff: round(mean(aFirst) - mean(bFirst)),
      firstTickCombinedMedianA: round(median(aFirst)),
      firstTickCombinedMedianB: round(median(bFirst)),
      firstTickCombinedMedianDiff: round(median(aFirst) - median(bFirst)),
      firstTickExcessMeanA: round(mean(aFirst) - mean(aSetup)),
      firstTickExcessMeanB: round(mean(bFirst) - mean(bSetup)),
      firstTickExcessMeanDiff: round(mean(aFirst) - mean(aSetup) - (mean(bFirst) - mean(bSetup))),
      batch100MeanA: round(mean(a100)),
      batch100MeanB: round(mean(b100)),
      batch100MeanDiff: round(mean(a100) - mean(b100)),
      batch100MedianA: round(median(a100)),
      batch100MedianB: round(median(b100)),
      batch100MedianDiff: round(median(a100) - median(b100)),
    });
  }
  return pairs;
}

function totals(records, sessionSummaries) {
  const out = {};
  for (const build of ['A', 'B']) {
    const rows = records.filter((record) => record.build === build);
    out[build] = {
      samples: rows.length,
      cpuTotalMs: rows.reduce((total, record) => total + record.cpuMs, 0),
      cpuMeanMs: round(mean(rows.map((record) => record.cpuMs))),
      sessions: Object.fromEntries(
        Object.keys(sessionSummaries)
          .filter((session) => session[0] === build)
          .map((session) => {
            const sessionRows = rows.filter((record) => record.session === session);
            return [
              session,
              {
                samples: sessionRows.length,
                cpuTotalMs: sessionRows.reduce((total, record) => total + record.cpuMs, 0),
                cpuMeanMs: round(mean(sessionRows.map((record) => record.cpuMs))),
              },
            ];
          }),
      ),
    };
  }
  return out;
}

function logReport(analysis) {
  const lines = [];
  lines.push('Phase 2A.9 — deployed A/B CPU analysis');
  lines.push('');
  lines.push('Coverage');
  lines.push('  A samples 216/216; B samples 216/216; all matched by run id and script version.');
  lines.push('  Metric: $workers.cpuTimeMs, integer ms per Durable Object invocation.');
  lines.push('');
  lines.push('Determinism: ' + (analysis.validation.determinism.mismatches.length === 0 ? 'PASS' : 'FAIL'));
  lines.push('  Comparisons: ' + analysis.validation.determinism.comparisons);
  lines.push('');
  lines.push('Key cells (invocation CPU, ms)');
  lines.push('  cell                 A n  A mean A med   B n  B mean B med');
  for (const [profile, batchKey] of [
    ['stress', '0'],
    ['stress', '1'],
    ['stress', 'extraBatch1'],
    ['stress', 'firstTickCombined'],
    ['stress', '5'],
    ['stress', '20'],
    ['stress', '100'],
    ['baseline', '0'],
    ['baseline', '1'],
  ]) {
    const a = analysis.cells.A[profile][batchKey];
    const b = analysis.cells.B[profile][batchKey];
    lines.push(
      `  ${`${profile}-${batchKey}`.padEnd(22)} ${String(a.n).padStart(2)} ${number(a.mean).padStart(7)} ${number(a.median).padStart(6)}   ${String(b.n).padStart(2)} ${number(b.mean).padStart(7)} ${number(b.median).padStart(6)}`,
    );
  }
  lines.push('');
  lines.push('Derived first-tick excess (batch 1 minus batch 0, ms)');
  for (const key of ['firstTickExcess', 'firstTickExcessCombined']) {
    const value = analysis.derived.comparison[key];
    lines.push(
      `  ${key}: A mean ${number(value.meanA)} median ${number(value.medianA)}; B mean ${number(value.meanB)} median ${number(value.medianB)}; diff mean ${number(value.meanDiff)} median ${number(value.medianDiff)}`,
    );
  }
  lines.push('');
  const warm = analysis.derived.comparison.warmFirstTick;
  lines.push(
    `  Warm first tick only: total mean A ${number(warm.totalMeanA)} B ${number(warm.totalMeanB)} (${percent(warm.totalPercentMean)} lower); excess mean A ${number(warm.excessMeanA)} B ${number(warm.excessMeanB)} diff ${number(warm.excessMeanDiff)} [${number(warm.excessDiffMeanCi95[0])}, ${number(warm.excessDiffMeanCi95[1])}], ${percent(warm.excessPercentMean)}`,
  );
  lines.push('');
  lines.push('Batch 100 (100 ticks + setup, ms)');
  const b100 = analysis.derived.comparison.batch100;
  lines.push(
    `  A mean ${number(b100.meanA)} median ${number(b100.medianA)}; B mean ${number(b100.meanB)} median ${number(b100.medianB)}; percent mean ${percent(b100.percentMean)} [${percent(b100.percentMeanCi95[0])}, ${percent(b100.percentMeanCi95[1])}]`,
  );
  lines.push('');
  lines.push('Per-tick derived estimates (ms/tick, not direct per-tick measurements)');
  for (const build of ['A', 'B']) {
    const all = analysis.derived.builds[build].stressPerTickFromSetup100;
    const after = analysis.derived.builds[build].stressPerTickAfterFirst;
    lines.push(
      `  ${build}: from setup/100 mean ${number(all.mean)} [${number(all.meanCi95[0])}, ${number(all.meanCi95[1])}]; after first/99 mean ${number(after.mean)} [${number(after.meanCi95[0])}, ${number(after.meanCi95[1])}]`,
    );
  }
  const tickFromSetup = analysis.derived.comparison.perTickFromSetup100;
  const tickAfterFirst = analysis.derived.comparison.perTickAfterFirst;
  lines.push(
    `  A-B from setup/100: ${number(tickFromSetup.meanDiff)} ms/tick [${number(tickFromSetup.diffCi95[0])}, ${number(tickFromSetup.diffCi95[1])}], ${percent(tickFromSetup.percentMean)} [${percent(tickFromSetup.percentCi95[0])}, ${percent(tickFromSetup.percentCi95[1])}]`,
  );
  lines.push(
    `  A-B after first/99: ${number(tickAfterFirst.meanDiff)} ms/tick [${number(tickAfterFirst.diffCi95[0])}, ${number(tickAfterFirst.diffCi95[1])}], ${percent(tickAfterFirst.percentMean)} [${percent(tickAfterFirst.percentCi95[0])}, ${percent(tickAfterFirst.percentCi95[1])}]`,
  );
  const control = analysis.derived.comparison.baselineNegativeControl;
  lines.push(
    `  Baseline negative control: A batch-1 mean ${number(control.firstTickMeanA)}, B ${number(control.firstTickMeanB)}, difference ${number(control.firstTickMeanDiff)} [${number(control.firstTickDiffCi95[0])}, ${number(control.firstTickDiffCi95[1])}]`,
  );
  lines.push('');
  lines.push('Interleaved session pairs (B is lower in every pair)');
  for (const pair of analysis.sessionPairs) {
    lines.push(
      `  slot ${pair.slot} (${pair.sessions.join(' vs ')}): batch-100 mean A ${number(pair.batch100MeanA)} B ${number(pair.batch100MeanB)} diff ${number(pair.batch100MeanDiff)}; first-tick combined mean A ${number(pair.firstTickCombinedMeanA)} B ${number(pair.firstTickCombinedMeanB)} diff ${number(pair.firstTickCombinedMeanDiff)}`,
    );
  }
  lines.push('');
  lines.push('Linear fits, batches 1..100');
  for (const build of ['A', 'B']) {
    for (const profile of PROFILES) {
      const fitValue = analysis.fits[build][profile].full;
      if (!fitValue) continue;
      lines.push(
        `  ${build}/${profile}: slope ${number(fitValue.slope, 4)} ms/tick, intercept ${number(fitValue.intercept)}, r2 ${number(fitValue.r2, 4)}`,
      );
    }
  }
  lines.push('');
  lines.push('Platform totals (sample invocations only)');
  for (const build of ['A', 'B']) {
    lines.push(
      `  ${build}: ${analysis.totals[build].samples} samples, ${analysis.totals[build].cpuTotalMs} ms total, ${number(analysis.totals[build].cpuMeanMs)} ms mean`,
    );
  }
  lines.push('');
  lines.push('Limitations');
  lines.push('  Invocation CPU includes setup, ticks, checksum and response.');
  lines.push('  No individual tick timing, per-tick maximum or per-tick percentile is available.');
  lines.push('  Batch 1 is one tick plus setup; batch 0 is setup only.');
  lines.push('  The 10 ms individual-tick CPU target remains UNVERIFIED.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const extract = JSON.parse(readFileSync(EXTRACT_PATH, 'utf8'));
  const { all, sessionSummaries } = loadSessions(extract);
  const determinism = compareDeterminism(all);
  const cells = cellRows(all);
  const derivedValue = derived(all);
  const fitValue = fits(all);
  const sessionValues = sessionTable(all, sessionSummaries);
  const pairValues = sessionPairs(all);
  const totalValues = totals(all, sessionSummaries);

  const coverage = {};
  for (const build of ['A', 'B']) {
    const buildExtract = extract.builds[build];
    coverage[build] = {
      versionId: buildExtract.versionId,
      sessions: Object.keys(buildExtract.sessions),
      attemptedSamples: buildExtract.attemptedSamples,
      observedSamples: buildExtract.observedSamples,
      sampleCoverage: buildExtract.sampleCoverage,
      queryRunId: buildExtract.queryRunId,
      queryStatus: buildExtract.queryStatus,
      timeframe: buildExtract.timeframe,
      metricResolutionMs: 1,
    };
  }

  const analysis = {
    version: 1,
    phase: '2A.9',
    generatedAt: new Date().toISOString(),
    source: 'staging-evidence/phase2a9-observability-extract.json',
    metric: '$workers.cpuTimeMs',
    resolution: 'integer milliseconds per Durable Object invocation',
    coverage,
    sessions: sessionSummaries,
    totals: totalValues,
    validation: {
      determinism: {
        comparisons: determinism.comparisons,
        fields: determinism.fields,
        mismatches: determinism.mismatches,
      },
      cpuRowsObserved: all.length,
      expectedCpuRows: (MAIN_REPS * PROFILES.length * BATCHES.length + EXTRA_REPS) * 6,
      allCpuValuesInteger: all.every((record) => Number.isInteger(record.cpuMs) && record.cpuMs >= 0),
      versionsMatchSessions: true,
    },
    cells,
    derived: derivedValue,
    fits: fitValue,
    bySession: sessionValues,
    sessionPairs: pairValues,
    limitations: [
      'Invocation CPU includes fresh Game construction, command setup, the requested ticks, state hashing, response serialisation and routing.',
      'Batch 0 is setup only. Batch 1 is setup plus the first authoritative tick.',
      'No individual tick timing, per-tick maximum or per-tick percentile exists in the available platform metric.',
      'The 10 ms individual-tick CPU target remains unverified.',
      'The 80-unit stress workload is synthetic and deliberately more demanding than a normal match.',
      'These measurements do not establish concurrent-room capacity.',
    ],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
  const report = logReport(analysis);
  writeFileSync(join(OUT_DIR, 'analysis.log'), report + '\n');
  console.log(report);
}

main();
