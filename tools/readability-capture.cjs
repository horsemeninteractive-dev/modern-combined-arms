// Local-only capture sink for the Phase 5 review pack.
// Receives PNG data URLs from the browser and writes them under docs/visual-audit/p5.
// Run with `node tools/readability-capture.cjs` while the dev server is open.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(__dirname, '..', 'docs', 'visual-audit', 'p5');
fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/save') {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 25_000_000) req.destroy();
  });
  req.on('end', () => {
    try {
      const { name, data } = JSON.parse(body);
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('bad name');
      const comma = data.indexOf(',');
      if (!data.startsWith('data:image/png;base64,') || comma < 0) throw new Error('bad png');
      const file = path.join(outDir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data.slice(comma + 1), 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: `docs/visual-audit/p5/${name}.png`, bytes: fs.statSync(file).size }));
    } catch (err) {
      res.writeHead(400).end(String(err));
    }
  });
});

server.listen(8792, '127.0.0.1', () => {
  console.log('p5 capture sink on http://127.0.0.1:8792 ->', outDir);
});
