import { readFileSync } from 'node:fs';

const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const objects = [];
let depth = 0;
let start = 0;
let inString = false;
let escaped = false;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (inString) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') inString = false;
    continue;
  }
  if (ch === '"') {
    inString = true;
    continue;
  }
  if (ch === '{') {
    if (depth === 0) start = i;
    depth++;
  } else if (ch === '}') {
    depth--;
    if (depth === 0) {
      try {
        objects.push(JSON.parse(text.slice(start, i + 1)));
      } catch {
        /* skip malformed fragment */
      }
    }
  }
}

for (const entry of objects) {
  const event = entry.event ?? {};
  const at = new Date(entry.eventTimestamp).toISOString();
  const url = event.request?.url ?? '';
  const status = event.response?.status ?? '';
  console.log(
    [
      at,
      entry.entrypoint,
      entry.outcome,
      event.request?.method ?? '',
      status,
      url.replace('https://capacity', 'capacity:'),
      `cpu=${entry.cpuTime}`,
      `wall=${entry.wallTime}`,
      entry.exceptions?.length ? `exceptions=${entry.exceptions.length}` : '',
      entry.logs?.length ? `logs=${entry.logs.length}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
