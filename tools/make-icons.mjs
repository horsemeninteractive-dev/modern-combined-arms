// Rasterises the Irontide mark into the PWA icon set without any dependency:
// shapes are drawn at 4x and box-filtered into an RGBA buffer, then written as
// a PNG with zlib. Run `node tools/make-icons.mjs` after editing the mark; the
// generated PNGs under public/icons are the committed assets.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [11, 17, 20];
const FRAME = [241, 194, 126];
const WAVE = [224, 163, 74];

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

/** The hex plate and the tide crest, matching public/irontide-mark.svg. */
const plate = [[48, 4], [86, 26], [86, 70], [48, 92], [10, 70], [10, 26]];
const plateStroke = 4.5 / 2;
const waveStroke = 6.5 / 2;
const wavePath = [
  ...sampleCubic([20, 64], [28, 44], [40, 42], [47, 52]),
  ...sampleCubic([47, 52], [53, 61], [62, 58], [76, 44]).slice(1),
];
// Square caps: extend the two ends so the raster matches the SVG's linecap.
const wave = [
  extend(wavePath[0], wavePath[1], waveStroke),
  ...wavePath,
  extend(wavePath[wavePath.length - 1], wavePath[wavePath.length - 2], waveStroke),
];

function sampleCubic(p0, c1, c2, p1, steps = 28) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push([
      a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
      a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
    ]);
  }
  return points;
}

function extend(from, toward, distance) {
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / len) * distance, from[1] + (dy / len) * distance];
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
  const unit = (w / 96) * scale;
  const offset = (w - 96 * unit) / 2;
  const px = (x, y) => [x * unit + offset, y * unit + offset];

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

  const platePts = plate.map(([x, y]) => px(x, y));
  const wavePts = wave.map(([x, y]) => px(x, y));
  const plateHalf = plateStroke * unit;
  const waveHalf = waveStroke * unit;

  for (let y = Math.max(0, Math.floor(offset)); y < Math.min(w, Math.ceil(w - offset)); y++) {
    for (let x = Math.max(0, Math.floor(offset)); x < Math.min(w, Math.ceil(w - offset)); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const i = y * w + x;
      if (edgeDistance(cx, cy, platePts) <= plateHalf) put(i, FRAME);
      else if (strokeDistance(cx, cy, wavePts) <= waveHalf) put(i, WAVE);
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
