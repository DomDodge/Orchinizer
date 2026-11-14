// Turns the instrument recordings (bounced from Logic) into the game's sounds.
// Run from app/Orchinizer/ after adding or re-recording sounds:  node scripts/import-sounds.mjs
//
// In:  sound-sources/<file>_<n>.wav, one note per file, n = 0..NOTE_ROWS-1 semitones above the
//      instrument's C (chromatic: C, C#, D, ... ). <file> is the instrument id, or FILE_NAMES[id].
//      These are the full-quality masters; they stay out of git (see .gitignore).
// Out: assets/sounds/<id>_<n>.m4a  and  src/sounds.gen.ts           (phone previews)
//      ../../tv/src/audio/music/drum_beat.m4a, from sound-sources/drum_beat.wav (the TV backing track)
//      ../../tv/public/sounds/<id>_<n>.m4a  and  ../../tv/src/audio/samples.gen.js   (TV show)
//
// Each file is mixed down to mono, its trailing silence trimmed, and the whole instrument scaled
// by one gain so every instrument peaks at the same level (the notes keep their balance within
// an instrument). Then macOS's afconvert encodes it as AAC, about 1/30 the size of the WAV.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTRUMENT_GROUPS, NOTE_ROWS } from '../../../protocol/messages.ts';

const here = (p) => new URL(p, import.meta.url).pathname;
const SRC = here('../sound-sources/');
const PHONE_OUT = here('../assets/sounds/');
const PHONE_GEN = here('../src/sounds.gen.ts');
const TV_OUT = here('../../../tv/public/sounds/');
const TV_GEN = here('../../../tv/src/audio/samples.gen.js');

/** Recordings named differently from their instrument id. */
const FILE_NAMES = { sax: 'saxophone' };
const TARGET_PEAK = 0.89;
const SILENCE = 10 ** (-60 / 20); // trim the tail below -60 dB
const FADE_S = 0.01;
const BITRATE = 64000;

// ---- WAV in ----

/** Decodes a PCM WAV (16/24/32-bit integer or 32-bit float, any channel count) to mono floats. */
function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV file`);
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(body);
      if (tag === 0xfffe) tag = b.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID
      fmt = { tag, channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(b.length, body + size));
    }
    at = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt or data chunk`);
  const { tag, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  const read =
    tag === 3 && bits === 32 ? (o) => data.readFloatLE(o)
    : tag === 1 && bits === 16 ? (o) => data.readInt16LE(o) / 32768
    : tag === 1 && bits === 24 ? (o) => data.readIntLE(o, 3) / 8388608
    : tag === 1 && bits === 32 ? (o) => data.readInt32LE(o) / 2147483648
    : null;
  if (!read) throw new Error(`${path}: unsupported WAV format (tag ${tag}, ${bits}-bit)`);
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read((i * channels + c) * bytes);
    mono[i] = s / channels;
  }
  return { rate, samples: mono };
}

// ---- WAV out (an intermediate for afconvert) ----

function writeWav16(path, rate, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([head, data]));
}

/** The sound up to where it decays below SILENCE, with a short fade so it doesn't click. */
function trimmed(samples, rate) {
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) < SILENCE) end--;
  const out = samples.slice(0, Math.max(end, Math.round(rate * 0.05)));
  const fade = Math.min(out.length, Math.round(FADE_S * rate));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ---- import ----

const ids = Object.values(INSTRUMENT_GROUPS).flat();
const sourceFiles = existsSync(SRC) ? new Set(readdirSync(SRC)) : new Set();
const missing = [];
for (const id of ids) {
  for (let n = 0; n < NOTE_ROWS; n++) {
    const f = `${FILE_NAMES[id] ?? id}_${n}.wav`;
    if (!sourceFiles.has(f)) missing.push(f);
  }
}
if (missing.length) {
  console.error(`Missing ${missing.length} recording(s) in sound-sources/:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// Replace only instrument notes (<id>_<n>.m4a/.wav); leave other files there, e.g. a backing track.
const noteFile = new RegExp(`^(${ids.join('|')})_\\d+\\.(m4a|wav)$`);
for (const dir of [PHONE_OUT, TV_OUT]) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (noteFile.test(f)) rmSync(join(dir, f));
}
const tmp = join(tmpdir(), `orchinizer-sounds-${process.pid}.wav`);

for (const id of ids) {
  const notes = Array.from({ length: NOTE_ROWS }, (_, n) => readWav(join(SRC, `${FILE_NAMES[id] ?? id}_${n}.wav`)));
  let peak = 0;
  for (const { samples } of notes) for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) throw new Error(`${id}: every recording is silent`);
  const gain = TARGET_PEAK / peak;
  notes.forEach(({ rate, samples }, n) => {
    const out = trimmed(samples.map((s) => s * gain), rate);
    writeWav16(tmp, rate, out);
    const name = `${id}_${n}.m4a`;
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), tmp, join(PHONE_OUT, name)]);
    writeFileSync(join(TV_OUT, name), readFileSync(join(PHONE_OUT, name)));
  });
  console.log(`${id}: ${NOTE_ROWS} notes, gain ${(20 * Math.log10(gain)).toFixed(1)} dB`);
}
rmSync(tmp, { force: true });

// The backing track: a 2-bar 100 bpm drum loop the TV plays under every performance. Kept in
// stereo and at its own level, as mixed.
const BACKING = join(SRC, 'drum_beat.wav');
if (existsSync(BACKING)) {
  const out = here('../../../tv/src/audio/music/drum_beat.m4a');
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', BACKING, out]);
  console.log('drum_beat: backing track for the TV');
} else {
  console.warn('No sound-sources/drum_beat.wav: the TV keeps its current backing track.');
}

const header = '// Generated by app/Orchinizer/scripts/import-sounds.mjs. Do not edit; rerun the script.';
writeFileSync(
  PHONE_GEN,
  `${header}
// SOUNDS[id][n] is the recording n semitones above the instrument's C (row n of the note editor).
export const SOUNDS: Record<string, number[]> = {
${ids.map((id) => `  ${id}: [${Array.from({ length: NOTE_ROWS }, (_, n) => `require('../assets/sounds/${id}_${n}.m4a')`).join(', ')}],`).join('\n')}
};
`,
);
writeFileSync(
  TV_GEN,
  `${header}
// Every instrument with recordings in tv/public/sounds/<id>_<n>.m4a, n = 0..${NOTE_ROWS - 1}
// semitones above the instrument's C.
export const SAMPLED = ${JSON.stringify(ids)}
`,
);
console.log(`Wrote ${ids.length * NOTE_ROWS} sounds for ${ids.length} instruments.`);
