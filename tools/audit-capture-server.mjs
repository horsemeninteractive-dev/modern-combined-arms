/**
 * Tiny local capture sink for the read-only building audit (dev only).
 *
 * The browser cannot write files. This server accepts one PNG data URL from
 * the running game page and stores it under docs/visual-audit with a sanitised
 * name. It is never imported by the game and binds to loopback only.
 *
 *   node tools/audit-capture-server.mjs
 */

import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = 5201;
const ROOT = path.resolve('docs/visual-audit');
mkdirSync(ROOT, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/save')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const name = url.searchParams.get('name') ?? '';
  if (!/^[a-z0-9][a-z0-9._-]*\.png$/i.test(name)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad name');
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 30_000_000) {
      req.destroy();
    }
  });
  req.on('end', () => {
    const comma = body.indexOf(',');
    if (!body.startsWith('data:image/png;base64,') || comma < 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad image');
      return;
    }
    try {
      const png = Buffer.from(body.slice(comma + 1), 'base64');
      const target = path.join(ROOT, name);
      writeFileSync(target, png);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, path: target }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`building-audit capture sink on http://127.0.0.1:${PORT}`);
});
