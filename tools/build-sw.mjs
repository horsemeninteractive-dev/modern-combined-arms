// Post-build step: the worker is a plain file in public/, so it cannot see the
// hashed bundle names. This walk fills its precache list so a first visit leaves
// the whole app available offline, not just the shell.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLACEHOLDER = 'self.__PRECACHE_ASSETS__';
const SW_PATH = 'dist/sw.js';

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(join(dir, entry.name), rel);
    return entry.name.endsWith('.map') ? [] : [rel];
  });
}

const assets = walk('dist/assets').map((file) => `/assets/${file}`);
const precache = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/insignia.svg',
  // The HUD flies this crest as a mask tinted per coalition, so it is chrome
  // the shell needs offline just like the full-colour mark.
  '/insignia-crest.svg',
  '/insignia-aa.png',
  '/insignia-ep.png',
  '/irontide-mark.svg',
  '/studio-logo.mp4',
  '/audio/music/menu-theme.mp3',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  ...assets,
];

const source = readFileSync(SW_PATH, 'utf8');
if (!source.includes(PLACEHOLDER)) {
  throw new Error(`${SW_PATH} is missing ${PLACEHOLDER}`);
}
writeFileSync(SW_PATH, source.replace(PLACEHOLDER, JSON.stringify(precache)));
console.log(`sw.js precaches ${precache.length} files`);
