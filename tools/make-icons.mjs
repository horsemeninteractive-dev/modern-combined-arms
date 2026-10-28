// Rasterises the MCA insignia (public/insignia.svg) into the PWA icon set
// without any dependency: shapes are drawn at 4x and box-filtered into an RGBA
// buffer, then written as a PNG with zlib. Run `node tools/make-icons.mjs` after
// editing the insignia; the generated PNGs under public/icons are the committed
// assets. The Irontide engine mark is deliberately not used here: it belongs to
// the engine splash, not to the game's home-screen identity.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [11, 17, 20];
const BORDER = [224, 163, 74];
const INK = [241, 194, 126];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/*
 * The insignia, in its own 64-unit space: a framed amber monogram reading
 * MCA. Kept as plain polylines so the rasteriser stays dependency-free.
 */
const FRAME_RECT = { x: 3, y: 3, w: 58, h: 58, stroke: 2 };
const LETTER_STROKE = 3.4;
const GLYPHS = [
  // M
  [[9.5, 48], [9.5, 16], [15.5, 37], [21.5, 16], [21.5, 48]],
  // C
  [[35.5, 16], [27.5, 16], [27.5, 48], [35.5, 48]],
  // A
  [[41.5, 48], [47.5, 16], [53.5, 48]],
  // A crossbar
  [[45.6, 37], [49.4, 37]],
];

function extend(from, toward, distance) {
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / len) * distance, from[1] + (dy / len) * distance];
}

/** Square caps, matching the SVG's stroke-linecap. */
function withCaps(points, half) {
  return [
    extend(points[0], points[1], half),
    ...points,
    extend(points[points.length - 1], points[points.length - 2], half),
  ];
}

function strokeDistance(px, py, points) {
  let d = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    d = Math.min(d, segmentDistance(px, py, a[0], a[1], b[0], b[1]));
  }
  return d;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function edgeDistance(px, py, points) {
  let d = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    d = Math.min(d, segmentDistance(px, py, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** Draw the mark into an RGBA buffer with `size` pixels per side. */
function draw(size, { scale = 1 } = {}) {
  const ss = 4;
  const w = size * ss;
  // The drawing space is 96 units wide; the insignia is authored at 64.
  const unit = (w / 96) * scale;
  const offset = (w - 96 * unit) / 2;
  const px = (x, y) => [x * 1.5 * unit + offset, y * 1.5 * unit + offset];

  const hi = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < w * w; i++) {
    hi[i * 4] = BG[0];
    hi[i * 4 + 1] = BG[1];
    hi[i * 4 + 2] = BG[2];
    hi[i * 4 + 3] = 255;
  }
  const put = (i, color) => {
    hi[i * 4] = color[0];
    hi[i * 4 + 1] = color[1];
    hi[i * 4 + 2] = color[2];
  };

  const frameHalf = (FRAME_RECT.stroke / 2) * 1.5 * unit;
  const frame = [
    [FRAME_RECT.x, FRAME_RECT.y],
    [FRAME_RECT.x + FRAME_RECT.w, FRAME_RECT.y],
    [FRAME_RECT.x + FRAME_RECT.w, FRAME_RECT.y + FRAME_RECT.h],
    [FRAME_RECT.x, FRAME_RECT.y + FRAME_RECT.h],
  ].map(([x, y]) => px(x, y));
  const inkHalf = (LETTER_STROKE / 2) * 1.5 * unit;
  const glyphs = GLYPHS.map((points) => withCaps(points.map(([x, y]) => px(x, y)), inkHalf));

  for (let y = Math.max(0, Math.floor(offset)); y < Math.min(w, Math.ceil(w - offset)); y++) {
    for (let x = Math.max(0, Math.floor(offset)); x < Math.min(w, Math.ceil(w - offset)); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const i = y * w + x;
      if (edgeDistance(cx, cy, frame) <= frameHalf) put(i, BORDER);
      else if (glyphs.some((points) => strokeDistance(cx, cy, points) <= inkHalf)) put(i, INK);
    }
  }

  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * w + (x * ss + sx)) * 4;
          r += hi[i]; g += hi[i + 1]; b += hi[i + 2];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = r / (ss * ss);
      out[o + 1] = g / (ss * ss);
      out[o + 2] = b / (ss * ss);
      out[o + 3] = 255;
    }
  }
  return out;
}

mkdirSync('public/icons', { recursive: true });
for (const [size, name, scale] of [
  [180, 'icon-180.png', 1],
  [192, 'icon-192.png', 1],
  [512, 'icon-512.png', 1],
  [512, 'maskable-512.png', 0.68],
]) {
  const rgba = draw(size, { scale });
  writeFileSync(`public/icons/${name}`, encodePng(size, size, rgba));
  console.log(`icons/${name} ${size}x${size}`);
}
