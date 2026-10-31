#!/usr/bin/env node
// Summarise `wrangler tail --format json` events for Phase 2A.4.
//
//   node tools/phase2a4-tail-summary.mjs staging-evidence/phase2a4-main2-tail.jsonl
//
// Tail emits pretty-printed JSON objects back-to-back, not JSONL. This reader
// scans balanced braces (respecting strings) and never prints event payloads,
// request headers or tokens.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/phase2a4-tail-summary.mjs <tail.jsonl>');
  process.exit(2);
}

function parseObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(text.slice(start, index + 1)));
        } catch {
          /* ignore a partially written final object */
        }
        start = -1;
      }
    }
  }
  return objects;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function stats(values) {
  if (!values.length) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null, sum: null };
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    sum: values.reduce((sum, value) => sum + value, 0),
  };
}

const events = parseObjects(readFileSync(path, 'utf8'));
const groups = new Map();
for (const event of events) {
  const url = event.event?.request?.url ?? '';
  let route = 'unknown';
  try {
    route = new URL(url).pathname;
  } catch {
    route = url.startsWith('https://capacity/') ? url.slice('https://capacity'.length) : url;
  }
  const key = [
    event.entrypoint ?? 'unknown',
    event.executionModel ?? 'unknown',
    route,
    event.event?.request?.method ?? '',
    event.outcome ?? 'unknown',
  ].join(' | ');
  const group = groups.get(key) ?? { key, cpu: [], wall: [], timestamps: [] };
  group.cpu.push(event.cpuTime ?? 0);
  group.wall.push(event.wallTime ?? 0);
  group.timestamps.push(event.eventTimestamp ?? 0);
  groups.set(key, group);
}

const summary = {
  file: path,
  events: events.length,
  scriptVersions: [...new Set(events.map((event) => event.scriptVersion?.id).filter(Boolean))],
  firstEventAt: events.length ? new Date(Math.min(...events.map((e) => e.eventTimestamp ?? 0))).toISOString() : null,
  lastEventAt: events.length ? new Date(Math.max(...events.map((e) => e.eventTimestamp ?? 0))).toISOString() : null,
  exceptions: events.filter((event) => (event.exceptions ?? []).length > 0).length,
  truncated: events.filter((event) => event.truncated === true).length,
  groups: [...groups.values()].map((group) => ({
    key: group.key,
    count: group.cpu.length,
    cpuMs: stats(group.cpu),
    wallMs: stats(group.wall),
  })),
};
console.log(JSON.stringify(summary, null, 2));
