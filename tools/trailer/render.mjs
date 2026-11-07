#!/usr/bin/env node
/**
 * Trailer assembly (dev only).
 *
 * `capture.mjs` shoots each beat inside the real game and writes one `.webm`
 * per shot. This step turns those takes into the finished film: it normalises
 * the takes to a single frame rate, cuts them to the authored durations with
 * short dips at each cut, lays the game's own battle music underneath, drops
 * the Kokoro voiceover on its marks, and masters the mix for web playback.
 *
 *   node tools/trailer/render.mjs                       # full film
 *   node tools/trailer/render.mjs --music "Forward Command"
 *   node tools/trailer/render.mjs --out trailer/out/draft.mp4
 *
 * The narration marks are resolved from the shot durations in `script.js`, so
 * re-timing a shot there moves its line with it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { SHOTS } from './script.js';

const ROOT = process.cwd();
const RAW = path.join(ROOT, 'trailer', 'raw');
const SEGMENTS = path.join(ROOT, 'trailer', 'segments');
const AUDIO = path.join(ROOT, 'trailer', 'audio');
const OUT = path.join(ROOT, 'trailer', 'out');
const MUSIC_DIR = path.join(ROOT, 'public', 'audio', 'music');
const FFMPEG = process.env.FFMPEG_PATH
  ?? path.join(ROOT, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
/** Length of the dip at an interior cut, in seconds. */
const CUT_FADE = 0.16;
const OPEN_FADE = 1.0;
const CLOSE_FADE = 1.4;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const MUSIC_TRACK = flag('music', 'Forward Command');
/**
 * Stem placement, in integrated LUFS, measured rather than guessed.
 *
 * The game's own mix is quiet: its engine beds and gunfire sit around 20 dB
 * under a mastered music track, which is correct in play (music is optional and
 * ducked) and useless in a trailer, where the gameplay would vanish under the
 * score. Each stem is therefore lifted to its own measured target instead of a
 * fixed guess that would break the moment the game's mix changes.
 */
const GAME_TARGET_LUFS = Number(flag('game-lufs', -25));
const MUSIC_TARGET_LUFS = Number(flag('music-lufs', -28));
const VO_GAIN_DB = Number(flag('vo-gain', 0));
/** Web delivery loudness and true-peak ceiling. */
const MASTER_LUFS = Number(flag('lufs', -15));
const PEAK_CEILING_DB = -1.5;
/**
 * Stems are summed, not normalised, so the sum needs room to breathe before
 * mastering: mixing at full scale would clip the loudest hit into the narration
 * and leave the limiter nothing to work with.
 */
const MIX_HEADROOM = 0.75;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ffmpeg(argv) {
  return execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], {
    stdio: ['ignore', 'inherit', 'pipe'],
    encoding: 'utf8',
  });
}

function mediaSeconds(file) {
  // A MediaRecorder WebM carries no duration header, so ask the decoder how
  // much it actually decodes rather than trusting container metadata.
  const result = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const matches = [...`${result.stderr ?? ''}`.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const match = matches.at(-1);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

function secondsToTimestamp(seconds) {
  const whole = Math.floor(seconds);
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  const ms = String(Math.round((seconds - whole) * 1000)).padStart(3, '0');
  return `${mm}:${ss}.${ms}`;
}

/* -------------------------------------------------------------------------- */
/* 1. Normalise each take                                                     */
/* -------------------------------------------------------------------------- */

function prepareSegments() {
  mkdirSync(SEGMENTS, { recursive: true });
  const timeline = [];
  let cursor = 0;

  for (const [index, shot] of SHOTS.entries()) {
    const source = path.join(RAW, `clip-${shot.id}.webm`);
    if (!existsSync(source)) fail(`missing take: ${source} (run: node tools/trailer/capture.mjs record)`);
    const available = mediaSeconds(source);
    const shortfall = shot.duration - available;
    if (shortfall > 0.6) {
      fail(`${shot.id}: take is ${available.toFixed(2)}s, shot wants ${shot.duration}s — reshoot it`);
    }
    // A take can end a few frames early when the recorder closes; the missing
    // tail is inside the fade to the next beat, so holding the last frame keeps
    // the authored timeline exact instead of letting the film drift.
    // A take can end a few frames early when the recorder closes; the missing
    // tail is inside the fade to the next beat, so holding the last frame keeps
    // the authored timeline exact instead of letting the film drift. The extra
    // headroom means `-t` is always what ends a segment, never the source, so
    // every segment lands on a frame boundary.
    const pad = `,tpad=stop_mode=clone:stop_duration=${(Math.max(0, shortfall) + 0.4).toFixed(3)}`;

    const first = index === 0;
    const last = index === SHOTS.length - 1;
    const fadeIn = first ? OPEN_FADE : CUT_FADE;
    const fadeOut = last ? CLOSE_FADE : CUT_FADE;
    const videoFade = [
      `fade=t=in:st=0:d=${fadeIn}`,
      `fade=t=out:st=${(shot.duration - fadeOut).toFixed(3)}:d=${fadeOut}`,
    ].join(',');
    const audioFade = [
      `afade=t=in:st=0:d=${fadeIn}`,
      `afade=t=out:st=${(shot.duration - fadeOut).toFixed(3)}:d=${fadeOut}`,
      'apad',
    ].join(',');

    const segment = path.join(SEGMENTS, `${shot.id}.mp4`);
    ffmpeg([
      '-i', source,
      '-t', String(shot.duration),
      // The takes come out of Chrome tagged full-range; the film is delivered
      // as limited-range BT.709 like every other web video, or it looks washed
      // out next to anything else.
      '-vf', `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos:out_range=tv,setsar=1,format=yuv420p${pad},${videoFade}`,
      '-af', audioFade,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      segment,
    ]);

    timeline.push({ id: shot.id, start: cursor, duration: shot.duration });
    cursor += shot.duration;
    console.log(`  ${shot.id.padEnd(18)} ${shot.duration.toFixed(2)}s  @ ${cursor.toFixed(2)}s`);
  }

  return { timeline, total: cursor };
}

function concatFilm(timeline) {
  const list = path.join(SEGMENTS, 'concat.txt');
  writeFileSync(
    list,
    timeline.map((entry) => `file '${path.join(SEGMENTS, `${entry.id}.mp4`).replace(/\\/g, '/')}'`).join('\n') + '\n',
    'utf8',
  );
  const film = path.join(SEGMENTS, 'film.mp4');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', film]);
  return film;
}

/* -------------------------------------------------------------------------- */
/* 2. Mix music and narration                                                 */
/* -------------------------------------------------------------------------- */

function narration(total) {
  const file = path.join(AUDIO, 'manifest.json');
  if (!existsSync(file)) fail(`no narration yet: run tools/trailer/voice.py first (${file})`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const starts = new Map();
  let cursor = 0;
  for (const shot of SHOTS) {
    starts.set(shot.id, cursor);
    cursor += shot.duration;
  }
  const cues = [];
  for (const line of manifest.lines) {
    const shotStart = starts.get(line.shot);
    if (shotStart === undefined) {
      console.warn(`  narration ${line.id} targets unknown shot ${line.shot}, skipped`);
      continue;
    }
    const at = shotStart + line.at;
    if (at + line.seconds > total + 0.01) {
      console.warn(`  narration ${line.id} runs past the end of the film (${(at + line.seconds).toFixed(2)}s > ${total.toFixed(2)}s)`);
    }
    cues.push({ ...line, start: at });
  }
  return cues;
}

/** Integrated loudness and true peak of a file (or of one of its streams). */
function loudness(file) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const text = `${result.stderr ?? ''}`.slice(`${result.stderr ?? ''}`.lastIndexOf('Summary:'));
  const integrated = /I:\s*(-?\d+(?:\.\d+)?) LUFS/.exec(text);
  const peak = /Peak:\s*(-?\d+(?:\.\d+)?) dBFS/.exec(text);
  if (!integrated) fail(`could not measure ${path.basename(file)}`);
  return { integrated: Number(integrated[1]), truePeak: peak ? Number(peak[1]) : 0 };
}

/** Build the unmastered mix (game audio + music + narration) as PCM. */
function mixAudio(film, total, cues) {
  const music = path.join(MUSIC_DIR, `${MUSIC_TRACK}.mp3`);
  if (!existsSync(music)) fail(`missing music track: ${music}`);

  const inputs = ['-i', film, '-stream_loop', '-1', '-i', music];
  for (const cue of cues) inputs.push('-i', path.join(ROOT, cue.file));

  const gameplay = loudness(film);
  const score = loudness(music);
  const gameplayGain = GAME_TARGET_LUFS - gameplay.integrated;
  const scoreGain = MUSIC_TARGET_LUFS - score.integrated;
  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`;
  console.log(`  gameplay ${gameplay.integrated.toFixed(1)} LUFS ${signed(gameplayGain)}, music ${score.integrated.toFixed(1)} LUFS ${signed(scoreGain)}`);

  // The game's own battle music sits under the action: it carries the mood
  // while the engines, gunfire and narration stay legible on top.
  const fadeOutAt = Math.max(0, total - 3);
  const filters = [
    `[0:a]volume=${gameplayGain.toFixed(2)}dB[game]`,
    `[1:a]atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,volume=${scoreGain.toFixed(2)}dB,` +
      `afade=t=in:st=0:d=2.5,afade=t=out:st=${fadeOutAt.toFixed(3)}:d=3[music]`,
  ];

  const voiceLabels = [];
  cues.forEach((cue, index) => {
    const delayMs = Math.round(cue.start * 1000);
    const label = `vo${index}`;
    filters.push(`[${index + 2}:a]aresample=48000,adelay=${delayMs}|${delayMs},volume=${VO_GAIN_DB}dB[${label}]`);
    voiceLabels.push(`[${label}]`);
  });
  if (voiceLabels.length > 0) {
    filters.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[voice]`);
  }

  const mixInputs = ['[game]', '[music]', ...(voiceLabels.length ? ['[voice]'] : [])];
  filters.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:dropout_transition=0[summed]`,
    // A bus compressor evens the narration peaks against the beds, which is
    // what lets the trailer reach broadcast loudness without the limiter
    // flattening every hit into the same level.
    `[summed]volume=${MIX_HEADROOM},acompressor=threshold=-16dB:ratio=1.8:attack=8:release=180[mixed]`,
  );

  const wav = path.join(SEGMENTS, 'mix.wav');
  ffmpeg([
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[mixed]',
    '-t', total.toFixed(3),
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    wav,
  ]);
  return wav;
}

/**
 * Master the mix to delivery loudness.
 *
 * Mastering is a measured gain, not a `loudnorm` one-shot: single-pass loudnorm
 * chases its target with a dynamic curve, which audibly pumps a trailer whose
 * whole point is loud hits against quiet holds. When the gain needed to reach
 * the target would push the peak past the ceiling, the peak wins — a quieter
 * trailer is better than a squashed one.
 */
function masterGain(measured) {
  const toTarget = MASTER_LUFS - measured.integrated;
  const toCeiling = PEAK_CEILING_DB - measured.truePeak;
  return Math.min(toTarget, toCeiling);
}

function master(film, wav, total, gainDb, output) {
  ffmpeg([
    '-i', film,
    '-i', wav,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    // The limiter only has to catch the loudest hit; the gain does the work.
    '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.841:level=false,aresample=48000`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', total.toFixed(3),
    '-movflags', '+faststart',
    output,
  ]);
}

/* -------------------------------------------------------------------------- */
/* 3. Poster                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The poster is a frame of the film, not a separate marketing render: it always
 * matches the grade, the framing and the build that shipped the trailer.
 */
function poster(film, output) {
  const at = Number(flag('poster-at', 19.8));
  const target = path.join(path.dirname(output), 'poster.jpg');
  ffmpeg(['-ss', at.toFixed(2), '-i', film, '-frames:v', '1', '-q:v', '3', target]);
  return target;
}

/* -------------------------------------------------------------------------- */

function main() {
  if (!existsSync(FFMPEG)) fail(`ffmpeg is not installed: expected ${FFMPEG}`);
  console.log('normalising takes');
  const { timeline, total } = prepareSegments();
  const film = concatFilm(timeline);
  const cues = narration(total);
  console.log(`mixing ${cues.length} narration cue(s) over ${total.toFixed(2)}s with "${MUSIC_TRACK}"`);
  const wav = mixAudio(film, total, cues);
  const measured = loudness(wav);
  const gainDb = masterGain(measured);
  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)} dB`;
  console.log(`  mix at ${measured.integrated.toFixed(1)} LUFS, peak ${measured.truePeak.toFixed(1)} dBFS -> master ${signed(gainDb)}`);
  const output = path.resolve(flag('out', path.join(OUT, 'modern-combined-arms-trailer.mp4')));
  mkdirSync(path.dirname(output), { recursive: true });
  master(film, wav, total, gainDb, output);
  const cover = poster(film, output);
  const size = (statSync(output).size / (1024 * 1024)).toFixed(1);
  writeFileSync(
    path.join(path.dirname(output), 'timeline.json'),
    JSON.stringify({ film: path.basename(output), total, music: MUSIC_TRACK, shots: timeline, narration: cues }, null, 2) + '\n',
    'utf8',
  );
  console.log(`\n${output}  ${size} MB`);
  console.log(`timeline  ${secondsToTimestamp(total)}`);
  if (cover) console.log(`poster    ${cover}`);
}

main();
