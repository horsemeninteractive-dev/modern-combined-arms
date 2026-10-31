#!/usr/bin/env node
// Phase 2A.2 Cloudflare GraphQL evidence collector.
//
// Requires a token with Workers Scripts Read (or the Content Read-Only Workers
// role). The token is read from CLOUDFLARE_API_TOKEN and never written to the
// evidence directory or printed.
//
//   CLOUDFLARE_API_TOKEN=... MP_ACCOUNT_ID=... \
//     MP_ROOM_ID=soak-... MP_START=2026-10-30T03:00:00Z \
//     MP_END=2026-10-30T03:31:00Z \
//     MP_OUT_DIR=staging-evidence/phase2a2-main \
//     node tools/phase2a2-metrics.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.MP_ACCOUNT_ID;
const roomId = process.env.MP_ROOM_ID;
const start = process.env.MP_START;
const end = process.env.MP_END;
const outDir = process.env.MP_OUT_DIR;

if (!token) fail('CLOUDFLARE_API_TOKEN is required.');
if (!account) fail('MP_ACCOUNT_ID is required.');
if (!roomId || !/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) fail('MP_ROOM_ID is invalid.');
if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
  fail('MP_START and MP_END must be ISO timestamps.');
}
if (!outDir) fail('MP_OUT_DIR is required.');
mkdirSync(outDir, { recursive: true });

function fail(message) {
  console.error(message);
  process.exit(2);
}

function query(text) {
  return fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: text }),
  }).then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.errors?.length) {
      throw new Error(
        `GraphQL query failed: HTTP ${response.status} ${JSON.stringify(body?.errors ?? body)}`,
      );
    }
    return body.data;
  });
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + (selector(row) ?? 0), 0);
}

function min(rows, selector) {
  if (!rows.length) return null;
  return Math.min(...rows.map((row) => selector(row) ?? Number.POSITIVE_INFINITY));
}

function max(rows, selector) {
  if (!rows.length) return null;
  return Math.max(...rows.map((row) => selector(row) ?? 0));
}

function summarisePeriodic(rows) {
  return {
    rows: rows.length,
    firstAt: rows[0]?.dimensions.datetime ?? null,
    lastAt: rows.at(-1)?.dimensions.datetime ?? null,
    objectId: rows[0]?.dimensions.objectId ?? null,
    namespaceId: rows[0]?.dimensions.namespaceId ?? null,
    coloCode: rows[0]?.dimensions.coloCode ?? null,
    cpuTimeUs: sum(rows, (row) => row.sum.cpuTime),
    activeTimeUs: sum(rows, (row) => row.sum.activeTime),
    durationGbSeconds: sum(rows, (row) => row.sum.duration),
    inboundWebsocketMessages: sum(rows, (row) => row.sum.inboundWebsocketMsgCount),
    outboundWebsocketMessages: sum(rows, (row) => row.sum.outboundWebsocketMsgCount),
    rowsRead: sum(rows, (row) => row.sum.rowsRead),
    rowsWritten: sum(rows, (row) => row.sum.rowsWritten),
    storageReadUnits: sum(rows, (row) => row.sum.storageReadUnits),
    storageWriteUnits: sum(rows, (row) => row.sum.storageWriteUnits),
    subrequests: sum(rows, (row) => row.sum.subrequests),
    exceededCpuErrors: sum(rows, (row) => row.sum.exceededCpuErrors),
    exceededMemoryErrors: sum(rows, (row) => row.sum.exceededMemoryErrors),
    fatalInternalErrors: sum(rows, (row) => row.sum.fatalInternalErrors),
    memoryBytes: {
      first: rows[0]?.max.memoryUsageBytes ?? null,
      last: rows.at(-1)?.max.memoryUsageBytes ?? null,
      min: min(rows, (row) => row.max.memoryUsageBytes),
      max: max(rows, (row) => row.max.memoryUsageBytes),
    },
    memoryPercentiles: {
      note: 'Largest per-minute percentile across the window; scope is the Durable Object isolate reported by Cloudflare.',
      p50: max(rows, (row) => row.quantiles?.memoryUsageBytesP50),
      p90: max(rows, (row) => row.quantiles?.memoryUsageBytesP90),
      p99: max(rows, (row) => row.quantiles?.memoryUsageBytesP99),
      p999: max(rows, (row) => row.quantiles?.memoryUsageBytesP999),
    },
    activeWebsocketConnectionsMax: max(rows, (row) => row.max.activeWebsocketConnections),
    perMinute: rows.map((row) => ({
      at: row.dimensions.datetime,
      cpuTimeUs: row.sum.cpuTime,
      activeTimeUs: row.sum.activeTime,
      memoryBytes: row.max.memoryUsageBytes,
      memoryP50: row.quantiles?.memoryUsageBytesP50 ?? null,
      memoryP90: row.quantiles?.memoryUsageBytesP90 ?? null,
      memoryP99: row.quantiles?.memoryUsageBytesP99 ?? null,
      memoryP999: row.quantiles?.memoryUsageBytesP999 ?? null,
      activeWebsocketConnections: row.max.activeWebsocketConnections,
      inboundWebsocketMessages: row.sum.inboundWebsocketMsgCount,
      outboundWebsocketMessages: row.sum.outboundWebsocketMsgCount,
      rowsRead: row.sum.rowsRead,
      rowsWritten: row.sum.rowsWritten,
    })),
  };
}

function summariseInvocations(rows) {
  return {
    rows: rows.length,
    requests: sum(rows, (row) => row.sum.requests),
    errors: sum(rows, (row) => row.sum.errors),
    responseBodyBytes: sum(rows, (row) => row.sum.responseBodySize),
    wallTimeUs: sum(rows, (row) => row.sum.wallTime),
    entries: rows.map((row) => ({
      at: row.dimensions.datetime,
      status: row.dimensions.status,
      type: row.dimensions.type,
      scriptVersion: row.dimensions.scriptVersion,
      requests: row.sum.requests,
      errors: row.sum.errors,
      responseBodyBytes: row.sum.responseBodySize,
      wallTimeUs: row.sum.wallTime,
      cpuTimeP50Us: row.quantiles.cpuTimeP50,
      cpuTimeP95Us: row.quantiles.cpuTimeP95,
      cpuTimeP99Us: row.quantiles.cpuTimeP99,
      wallTimeP50Us: row.quantiles.wallTimeP50,
      wallTimeP95Us: row.quantiles.wallTimeP95,
      wallTimeP99Us: row.quantiles.wallTimeP99,
    })),
  };
}

function summariseStorage(rows) {
  return {
    rows: rows.length,
    firstAt: rows[0]?.dimensions.datetime ?? null,
    lastAt: rows.at(-1)?.dimensions.datetime ?? null,
    storedBytesFirst: rows[0]?.max.storedBytes ?? null,
    storedBytesLast: rows.at(-1)?.max.storedBytes ?? null,
    storedBytesMax: max(rows, (row) => row.max.storedBytes),
    points: rows.map((row) => ({
      at: row.dimensions.datetime,
      storedBytes: row.max.storedBytes,
    })),
  };
}

const baseFilter = `name: "${roomId}", datetime_geq: "${start}", datetime_lt: "${end}"`;
const first = await query(`
  query {
    viewer {
      accounts(filter: { accountTag: "${account}" }) {
        durableObjectsPeriodicGroups(
          filter: { ${baseFilter} }
          limit: 1000
          orderBy: [datetime_ASC]
        ) {
          dimensions { datetime namespaceId name objectId coloCode }
          sum {
            cpuTime activeTime duration
            inboundWebsocketMsgCount outboundWebsocketMsgCount
            rowsRead rowsWritten storageReadUnits storageWriteUnits subrequests
            exceededCpuErrors exceededMemoryErrors fatalInternalErrors
          }
          max { memoryUsageBytes activeWebsocketConnections }
          quantiles { memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999 }
        }
      }
    }
  }
`);
const periodicRows = first.viewer.accounts[0].durableObjectsPeriodicGroups ?? [];
const namespaceId = periodicRows[0]?.dimensions.namespaceId ?? process.env.MP_NAMESPACE_ID ?? null;
if (!namespaceId) {
  throw new Error('No periodic rows found and MP_NAMESPACE_ID was not supplied.');
}
const second = await query(`
  query {
    viewer {
      accounts(filter: { accountTag: "${account}" }) {
        durableObjectsInvocationsAdaptiveGroups(
          filter: { ${baseFilter} }
          limit: 1000
          orderBy: [datetime_ASC]
        ) {
          dimensions { datetime namespaceId name objectId scriptVersion status type }
          sum { requests errors responseBodySize wallTime }
          max { responseBodySize wallTime }
          quantiles {
            cpuTimeP50 cpuTimeP90 cpuTimeP95 cpuTimeP99
            wallTimeP50 wallTimeP95 wallTimeP99
          }
        }
        durableObjectsStorageGroups(
          filter: {
            namespaceIds_has: "${namespaceId}"
            datetime_geq: "${start}"
            datetime_lt: "${end}"
          }
          limit: 1000
          orderBy: [datetime_ASC]
        ) {
          dimensions { datetime }
          max { storedBytes }
        }
      }
    }
  }
`);
const accountData = second.viewer.accounts[0];
const invocationRows = accountData.durableObjectsInvocationsAdaptiveGroups ?? [];
const storageRows = accountData.durableObjectsStorageGroups ?? [];

const result = {
  query: {
    roomId,
    account: '[redacted]',
    start,
    end,
    namespaceId,
    generatedAt: new Date().toISOString(),
    datasets: [
      'durableObjectsPeriodicGroups',
      'durableObjectsInvocationsAdaptiveGroups',
      'durableObjectsStorageGroups',
    ],
  },
  periodic: summarisePeriodic(periodicRows),
  invocations: summariseInvocations(invocationRows),
  storage: summariseStorage(storageRows),
};

writeFileSync(join(outDir, 'platform-metrics.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  periodic: {
    rows: result.periodic.rows,
    cpuTimeMs: result.periodic.cpuTimeUs / 1000,
    activeTimeSeconds: result.periodic.activeTimeUs / 1_000_000,
    memoryFirstMb: result.periodic.memoryBytes.first / 1_048_576,
    memoryLastMb: result.periodic.memoryBytes.last / 1_048_576,
    memoryMaxMb: result.periodic.memoryBytes.max / 1_048_576,
    inboundWebsocketMessages: result.periodic.inboundWebsocketMessages,
    outboundWebsocketMessages: result.periodic.outboundWebsocketMessages,
    rowsRead: result.periodic.rowsRead,
    rowsWritten: result.periodic.rowsWritten,
  },
  invocations: {
    requests: result.invocations.requests,
    errors: result.invocations.errors,
    wallTimeSeconds: result.invocations.wallTimeUs / 1_000_000,
  },
  storage: {
    rows: result.storage.rows,
    storedBytesLast: result.storage.storedBytesLast,
  },
  out: join(outDir, 'platform-metrics.json'),
}, null, 2));
