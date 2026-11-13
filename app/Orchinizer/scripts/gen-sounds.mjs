// Generates the phone's note-preview samples: assets/sounds/*.wav and src/sounds.gen.ts.
// Run from app/Orchinizer/:  node scripts/gen-sounds.mjs
//
// Each instrument is a small additive synth that mimics its recipe in tv/src/audio/instruments.js,
// at the same octave, so a part sounds on the phone roughly as it will on the TV.
//
// Tonal instruments get one sample every SAMPLE_STEP semitones above C (0, 4, ... 20, enough for
// every key's five rows); the phone tunes the rest with the playback rate. Drum kits get one
// sample per row.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const SR = 22050;
const SAMPLE_STEP = 4;
const MAX_SEMITONE = 20; // B (11) + the scale's top degree (9)
const OUT_DIR = new URL('../assets/sounds/', import.meta.url);
const GEN_FILE = new URL('../src/sounds.gen.ts', import.meta.url);

// ---- building blocks ----

const TAU = Math.PI * 2;
const hz = (octave, semitone) => 440 * 2 ** (((octave + 1) * 12 + semitone - 69) / 12);

let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 1073741824) - 1;

/** Attack, decay to sustain, hold until `hold` seconds, then release. */
const adsr = (a, d, s, hold, r) => (t) =>
  t < a ? t / a : t < a + d ? 1 - ((1 - s) * (t - a)) / d : t < hold ? s : s * Math.exp(-(t - hold) / r);
/** A quick attack, then an exponential ring-out. */
const perc = (a, decay) => (t) => (t < a ? t / a : Math.exp(-(t - a) / decay));

const saw = (n) => 1 / n;
const square = (n) => (n % 2 ? 1 / n : 0);
const triangle = (n) => (n % 2 ? 1 / (n * n) : 0);

/**
 * Additive voice. Harmonic n of `wave` (or each [ratio, amp, decaySeconds] of `partials`) is
 * shaped by a lowpass at `cutoff` Hz (a number or a function of time), an optional per-harmonic
 * damping (upper harmonics die first, like a plucked string), vibrato, and the amplitude envelope.
 */
function voice(f, dur, { wave, partials, env, cutoff = 20000, damp = 0, vib, detune = [1], breath = 0, drop = 0 }) {
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const parts = partials ?? Array.from({ length: 40 }, (_, i) => [i + 1, wave(i + 1), Infinity]).filter(([, a]) => a);
  for (const d of detune) {
    const phases = new Float64Array(parts.length);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const vibrato = vib && t > vib.delay ? 2 ** ((vib.cents / 1200) * Math.sin(TAU * vib.rate * (t - vib.delay))) : 1;
      const ft = f * d * vibrato * (1 + drop * Math.exp(-t / 0.04));
      const c = typeof cutoff === 'function' ? cutoff(t) : cutoff;
      let s = 0;
      for (let k = 0; k < parts.length; k++) {
        const [ratio, amp, decay] = parts[k];
        const fk = ft * ratio;
        if (fk > SR / 2 - 300) continue;
        phases[k] += (TAU * fk) / SR;
        const lp = 1 / Math.sqrt(1 + (fk / c) ** 4);
        s += amp * lp * Math.exp(-t * (damp * ratio + 1 / decay)) * Math.sin(phases[k]);
      }
      out[i] += (s * env(t)) / detune.length;
    }
  }
  if (breath) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.15 * (noise() - lp);
      out[i] += breath * lp * env(i / SR);
    }
  }
  return out;
}

/** A pitched drum: a sine-ish membrane whose pitch falls from `bend` above to `f`. */
function membrane(f, dur, { decay, bend = 0.5, overtones = [], thump = 0 }) {
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const parts = [[1, 1], ...overtones];
  const phases = new Float64Array(parts.length);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ft = f * (1 + bend * Math.exp(-t / 0.03));
    let s = 0;
    for (let k = 0; k < parts.length; k++) {
      phases[k] += (TAU * ft * parts[k][0]) / SR;
      s += parts[k][1] * Math.exp(-t * k * 2) * Math.sin(phases[k]);
    }
    out[i] = s * Math.exp(-t / decay) + thump * noise() * Math.exp(-t / 0.015);
  }
  return out;
}

/** Noise, optionally high-passed (a first difference), with an exponential decay. */
function hiss(dur, decay, highpass) {
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = noise();
    out[i] = (highpass ? x - prev : x) * Math.exp(-i / SR / decay);
    prev = x;
  }
  return out;
}

const mix = (...layers) => {
  const out = new Float64Array(Math.max(...layers.map(([l]) => l.length)));
  for (const [l, g] of layers) for (let i = 0; i < l.length; i++) out[i] += l[i] * g;
  return out;
};

// ---- instruments (keep octaves in step with tv/src/audio/instruments.js) ----

const HELD = 0.95; // seconds per held sample; the phone stops a note early when it's shorter
const held = (a, d, s) => adsr(a, d, s, HELD - 0.2, 0.06);
const bowed = (cutoff, cents) => ({ wave: saw, env: held(0.1, 0.2, 0.85), cutoff, vib: { rate: 5.5, cents, delay: 0.15 }, detune: [0.997, 1.003] });
const brass = (base, octaves) => ({
  wave: saw,
  env: held(0.04, 0.2, 0.8),
  cutoff: (t) => base * 2 ** (octaves * (t < 0.06 ? t / 0.06 : 0.6 + 0.4 * Math.exp(-(t - 0.06) / 0.3))),
});

const TONAL = {
  violin: [5, HELD, bowed(3800, 14)],
  viola: [4, HELD, bowed(2600, 12)],
  cello: [3, HELD, bowed(1800, 10)],
  contrabass: [2, 0.8, { wave: saw, env: perc(0.003, 0.35), cutoff: 1400, damp: 2 }], // pizzicato
  harp: [4, 1.0, { wave: triangle, env: perc(0.002, 0.5) }],
  guitar: [3, 0.9, { wave: saw, env: perc(0.002, 0.45), cutoff: 3200, damp: 1.5 }],
  flute: [5, HELD, { partials: [[1, 1, Infinity], [2, 0.12, Infinity]], env: held(0.07, 0.1, 0.9), vib: { rate: 5, cents: 18, delay: 0.12 }, breath: 0.25 }],
  clarinet: [4, HELD, { wave: square, env: held(0.04, 0.1, 0.85), cutoff: 1600 }],
  sax: [4, HELD, { wave: saw, env: held(0.03, 0.15, 0.8), cutoff: 1500, vib: { rate: 4.5, cents: 14, delay: 0.1 } }],
  trumpet: [4, HELD, brass(450, 3)],
  trombone: [3, HELD, brass(250, 2.5)],
  tuba: [2, HELD, brass(120, 2)],
  xylophone: [5, 0.7, { partials: [[1, 1, 0.35], [3.93, 0.35, 0.06], [9.2, 0.12, 0.03]], env: perc(0.001, 1) }],
  piano: [4, 1.1, { partials: [1, 0.5, 0.25, 0.14, 0.07, 0.04].map((a, i) => [i + 1, a, 0.9 / (1 + i)]), env: perc(0.004, 2) }],
  organ: [3, HELD, { partials: [[1, 1, Infinity], [2, 0.7, Infinity], [3, 0.45, Infinity], [5, 0.3, Infinity], [8, 0.18, Infinity]], env: held(0.01, 0.01, 1) }],
  synth: [4, HELD, { wave: saw, env: held(0.02, 0.3, 0.6), cutoff: 1400, detune: [0.994, 1, 1.006] }],
};

const KITS = {
  // kick, snare, hat
  drums: [
    () => membrane(45, 0.6, { decay: 0.25, bend: 2.5 }),
    () => mix([hiss(0.35, 0.1, false), 0.8], [membrane(185, 0.35, { decay: 0.06, bend: 0.2 }), 0.5]),
    () => hiss(0.2, 0.03, true),
  ],
  // low drum, fifth, octave
  timpani: [65.41, 98.0, 130.81].map((f) => () =>
    membrane(f, 1.4, { decay: 0.5, bend: 0.06, overtones: [[1.5, 0.5], [1.98, 0.35], [2.44, 0.2]], thump: 0.3 }),
  ),
  // low bongo, high bongo, slap
  bongos: [
    () => membrane(196, 0.35, { decay: 0.12, bend: 0.3, overtones: [[2.3, 0.2]] }),
    () => membrane(293.66, 0.35, { decay: 0.1, bend: 0.3, overtones: [[2.3, 0.2]] }),
    () => mix([hiss(0.25, 0.03, true), 0.7], [membrane(420, 0.25, { decay: 0.02, bend: 0.1 }), 0.4]),
  ],
};

// ---- output ----

function wav(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const fade = Math.round(0.015 * SR);
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const tail = Math.min(1, (samples.length - 1 - i) / fade);
    const v = Math.max(-1, Math.min(1, (samples[i] / (peak || 1)) * 0.89 * tail));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.wav')) rmSync(new URL(f, OUT_DIR));

const banks = {};
const save = (name, samples) => {
  writeFileSync(new URL(`${name}.wav`, OUT_DIR), wav(samples));
  return `require('../assets/sounds/${name}.wav')`;
};
for (const [id, [octave, dur, recipe]] of Object.entries(TONAL)) {
  banks[id] = [];
  for (let semi = 0; semi <= MAX_SEMITONE; semi += SAMPLE_STEP) banks[id].push(save(`${id}_${semi}`, voice(hz(octave, semi), dur, recipe)));
}
for (const [id, hits] of Object.entries(KITS)) banks[id] = hits.map((make, row) => save(`${id}_${row}`, make()));

writeFileSync(
  GEN_FILE,
  `// Generated by scripts/gen-sounds.mjs. Do not edit; change the script and rerun it.
// Tonal: SOUNDS[id][i] is the note SAMPLE_STEP * i semitones above C. Drum kits: one sound per row.
export const SAMPLE_STEP = ${SAMPLE_STEP};

export const SOUNDS: Record<string, number[]> = {
${Object.entries(banks).map(([id, list]) => `  ${id}: [${list.join(', ')}],`).join('\n')}
};
`,
);
console.log(`wrote ${Object.values(banks).flat().length} samples for ${Object.keys(banks).length} instruments`);
