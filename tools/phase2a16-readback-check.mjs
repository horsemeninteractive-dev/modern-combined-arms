#!/usr/bin/env node
// Phase 2A.16 read-back access check against the deployed staging Worker.
//
//   MP_ADMIN_TOKEN=<token> node tools/phase2a16-readback-check.mjs <roomId>
//
// Proves the staging-only snapshot read-back is unreachable without the admin
// token, that a wrong token or a non-GET verb is refused, that a valid token
// receives the exact persisted bytes, that those bytes hash to the hash the
// server reported, and that the room's status is identical before and after.
//
// The room must already exist (a finished soak or smoke room is ideal). Nothing
// here creates, restarts, closes or restores a room.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const roomId = process.argv[2] ?? process.env.MP_ROOM_ID;
if (!roomId) {
  console.error('usage: node tools/phase2a16-readback-check.mjs <roomId>');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join('staging-evidence', `phase2a16-readback-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const route = `/api/multiplayer/rooms/${encodeURIComponent(roomId)}`;

async function call(path, method = 'GET', token = admin) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers });
  let body = null;
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: response.status, body };
}

const statusShape = (value) =>
  value
    ? {
        closed: value.closed ?? null,
        closedAt: value.closedAt ?? null,
        closedReason: value.closedReason ?? null,
        finalResult: value.finalResult ?? null,
        reservation: value.reservation ?? null,
        totalTicks: value.matchTiming?.totalTicks ?? null,
      }
    : null;

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
};

const statusBefore = await call(`${route}/status`);
const noToken = await call(`${route}/snapshot`, 'GET', '');
record('read-back without a token is refused', noToken.status === 403, `HTTP ${noToken.status}`);
const wrongToken = await call(`${route}/snapshot`, 'GET', 'definitely-not-the-token');
record('read-back with a wrong token is refused', wrongToken.status === 403, `HTTP ${wrongToken.status}`);
const postAttempt = await call(`${route}/snapshot`, 'POST');
record(
  'read-back refuses a non-GET method',
  postAttempt.status === 405 || postAttempt.status === 403 || postAttempt.status === 404,
  `HTTP ${postAttempt.status}`,
);
const badOption = await call(`${route}/snapshot?include=everything`);
record('read-back refuses an unsupported option', badOption.status === 400, `HTTP ${badOption.status}`);

const first = await call(`${route}/snapshot?include=text`);
record('read-back with the admin token succeeds', first.status === 200 && first.body?.ok === true,
  `HTTP ${first.status} code ${first.body?.code ?? 'none'}`);

let captured = null;
let hashMatches = null;
if (typeof first.body?.readback?.text === 'string') {
  const text = first.body.readback.text;
  const bytes = Buffer.from(text, 'utf8');
  const local = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(evidenceDir, 'persisted-snapshot.json'), text);
  captured = {
    byteLength: bytes.length,
    utf16Length: text.length,
    localSha256: local,
    serverSha256: first.body.readback.sha256,
  };
  hashMatches = local === first.body.readback.sha256;
  record('captured bytes hash to the reported hash', hashMatches, local);
  record(
    'captured bytes are valid JSON of the expected schema',
    (() => {
      try {
        const parsed = JSON.parse(text);
        return parsed.format === 'mca-room-snapshot' && typeof parsed.tick === 'number';
      } catch {
        return false;
      }
    })(),
  );
  record(
    'strict read-back validation passed',
    first.body.validation?.ok === true && first.body.validation?.strict === true,
    `validator ${first.body.validation?.function ?? 'unknown'}`,
  );
  record(
    'finished snapshot carries a finish time',
    first.body.lifecycle?.snapshotPhase === 'finished'
      ? first.body.lifecycle?.finishedSnapshotHasFinishTime === true
      : true,
    `phase ${first.body.lifecycle?.snapshotPhase ?? 'unknown'}`,
  );
  record(
    'persisted envelope and snapshot agree',
    first.body.lifecycle?.consistent === true,
    JSON.stringify({
      resultMatchesMeta: first.body.lifecycle?.resultMatchesMeta,
      finishedAtMatchesMeta: first.body.lifecycle?.finishedAtMatchesMeta,
    }),
  );
} else {
  record('read-back returned the exact stored text', false, 'no text in response');
}

const second = await call(`${route}/snapshot`);
record(
  'repeated read-back is byte-identical',
  second.body?.readback?.sha256 === first.body?.readback?.sha256 &&
    second.body?.readback?.byteLength === first.body?.readback?.byteLength,
  second.body?.readback?.sha256 ?? 'none',
);

const statusAfter = await call(`${route}/status`);
const before = statusShape(statusBefore.body);
const after = statusShape(statusAfter.body);
record(
  'room status is unchanged by the inspection',
  JSON.stringify(before) === JSON.stringify(after),
  `closed=${after?.closed}`,
);

const evidence = {
  phase: '2A.16',
  capturedAt: new Date().toISOString(),
  base,
  roomId,
  build: (await call('/api/multiplayer/health')).body,
  statusBefore: before,
  statusAfter: after,
  captured,
  hashMatchesServer: hashMatches,
  readback: first.body?.readback ?? null,
  lifecycle: first.body?.lifecycle ?? null,
  validation: first.body?.validation ?? null,
  snapshot: first.body?.snapshot ?? null,
  checks,
};
writeFileSync(join(evidenceDir, 'readback-check.json'), JSON.stringify(evidence, null, 2));
const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`evidence: ${evidenceDir}`);
if (failed.length) process.exitCode = 1;
