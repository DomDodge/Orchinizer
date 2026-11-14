// Instrument sounds. engine.js only depends on the interface below.
//
// Every instrument plays its own recordings (from Logic, imported by
// app/Orchinizer/scripts/import-sounds.mjs into tv/public/sounds/): one file per note, so each
// note is heard exactly as recorded. loadSamples() fetches them once audio is unlocked. Until an
// instrument's files have loaded (or if they fail to), it falls back to a synth recipe below.
//
//   await loadSamples()   start fetching every instrument's recordings (engine.unlock calls it)
//
//   const inst = create(instrument, destination, { key })
//     instrument   the server's instrument id, e.g. 'violin' (see /protocol INSTRUMENT_GROUPS).
//                  Unknown ids get the piano.
//     destination  Tone.js node to connect your output to (the engine's master bus).
//     key          the round's key, e.g. 'C', 'Bb'. Unused: rows are fixed pitches.
//
//   inst.play(row, time, duration?)
//     row       0..NOTE_ROWS-1: semitones above the instrument's C (chromatic, C up to the G#
//               above the next C), the same rows as the phone's note editor.
//     time      exact AudioContext time to sound the note. Always pass it through to
//               triggerAttack*/start(); never play "now", or it drifts off the beat.
//     duration  seconds the note is held (a stretched note is longer). Omitted for old grid
//               parts: an 8th note. Plucked synth fallbacks ring out on their own.
//
//   inst.setVolume(level, time?)
//     level 0-100 from the conductor. `time` is when the change should be heard
//     (omitted = right away). Called often (up to 10/s), so ramp rather than jump.
//
//   inst.dispose()
//     free every node; called when the performance ends.
//
// Each player gets their own instance, so two of the same instrument never share state.
import * as Tone from 'tone'
import { SAMPLED } from './samples.gen.js'

export const NOTE_ROWS = 21 // /protocol NOTE_ROWS

// The octave of each instrument's row 0 (a C), in scientific pitch (middle C = C4). Matches the
// phone's INSTRUMENTS[id].octave and the recordings.
const OCTAVES = {
  violin: 5, viola: 4, cello: 3, contrabass: 2, guitar: 3,
  flute: 5, clarinet: 4, sax: 4, trumpet: 4, trombone: 3, tuba: 2,
  piano: 4, organ: 3, synth: 4,
}

/** Note names for rows 0..NOTE_ROWS-1, chromatic from C in `octave`. */
export function rangeFor(octave) {
  const root = Tone.Frequency(`C${octave}`).toMidi()
  return Array.from({ length: NOTE_ROWS }, (_, n) => Tone.Frequency(root + n, 'midi').toNote())
}

// ---- recordings ----

const BASE = import.meta.env?.BASE_URL ?? '/'
const recordings = {} // id -> ToneAudioBuffer per row, once loaded
let loading = null

export function loadSamples() {
  loading ??= Promise.all(
    SAMPLED.map((id) =>
      Promise.all(Array.from({ length: NOTE_ROWS }, (_, n) => Tone.ToneAudioBuffer.fromUrl(`${BASE}sounds/${id}_${n}.m4a`)))
        .then((list) => (recordings[id] = list))
        .catch((e) => console.warn(`[audio] ${id} recordings didn't load; it will use a synth`, e)),
    ),
  )
  return loading
}

// A recorded instrument: every row has its own file, so the Sampler never retunes.
function sampled(destination, id) {
  const range = rangeFor(OCTAVES[id] ?? 4)
  const sampler = new Tone.Sampler({ urls: Object.fromEntries(range.map((note, n) => [note, recordings[id][n]])), release: 0.25 })
  return instrument(destination, sampler, [sampler], (row, time, duration) => {
    if (!range[row]) return
    sampler.triggerAttackRelease(range[row], Math.max(duration ?? Tone.Time('8n').toSeconds(), 0.08), time)
  })
}

// ---- synth fallbacks ----

// Shared plumbing: every instrument ends in one gain node, so setVolume works the same everywhere.
// `nodes` are disposed with it; `out` is the node that feeds the gain.
function instrument(destination, out, nodes, play) {
  const gain = new Tone.Gain(0.64).connect(destination) // 80/100, squared
  out.connect(gain)
  return {
    play,
    setVolume: (level, time) => gain.gain.rampTo((level / 100) ** 2, 0.05, time),
    dispose: () => [...nodes, gain].forEach((n) => n.dispose()),
  }
}

// A held instrument: a PolySynth through optional effects, sustained for the note's duration.
function held(destination, key, octave, voice, options, effects = []) {
  const notes = rangeFor(octave)
  const synth = new Tone.PolySynth(voice, options)
  const chain = [synth, ...effects]
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1])
  return instrument(destination, chain[chain.length - 1], chain, (row, time, duration) =>
    notes[row] && synth.triggerAttackRelease(notes[row], Math.max(duration ?? Tone.Time('8n').toSeconds(), 0.08), time),
  )
}

// A plucked string. PluckSynth is monophonic, so a few take turns.
function plucked(destination, key, octave, options) {
  const notes = rangeFor(octave)
  const out = new Tone.Gain(1)
  const voices = Array.from({ length: 4 }, () => new Tone.PluckSynth(options).connect(out))
  let next = 0
  return instrument(destination, out, [out, ...voices], (row, time) => {
    if (!notes[row]) return
    voices[next].triggerAttack(notes[row], time)
    next = (next + 1) % voices.length
  })
}

const bowed = (cutoff, vibratoDepth) => ({
  options: {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 14 },
    envelope: { attack: 0.12, decay: 0.2, sustain: 0.85, release: 0.35 },
    volume: -8,
  },
  effects: () => [new Tone.Filter(cutoff, 'lowpass'), new Tone.Vibrato(5.5, vibratoDepth)],
})

const brass = (baseFrequency, octaves) => ({
  options: {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.04, decay: 0.2, sustain: 0.8, release: 0.2 },
    filterEnvelope: { attack: 0.06, decay: 0.3, sustain: 0.6, release: 0.2, baseFrequency, octaves },
    volume: -10,
  },
})

const RECIPES = {
  // Strings
  violin: (d, k) => held(d, k, 5, Tone.Synth, bowed(3800, 0.12).options, bowed(3800, 0.12).effects()),
  viola: (d, k) => held(d, k, 4, Tone.Synth, bowed(2600, 0.1).options, bowed(2600, 0.1).effects()),
  cello: (d, k) => held(d, k, 3, Tone.Synth, bowed(1800, 0.08).options, bowed(1800, 0.08).effects()),
  contrabass: (d, k) => plucked(d, k, 2, { attackNoise: 0.6, dampening: 1400, resonance: 0.92, volume: 2 }), // pizzicato
  guitar: (d, k) => plucked(d, k, 3, { attackNoise: 1.2, dampening: 3200, resonance: 0.96, volume: 0 }),

  // Wind
  flute: (d, k) =>
    held(
      d, k, 5, Tone.Synth,
      { oscillator: { type: 'sine' }, envelope: { attack: 0.07, decay: 0.1, sustain: 0.9, release: 0.18 }, volume: -6 },
      [new Tone.Vibrato(5, 0.15)],
    ),
  clarinet: (d, k) =>
    held(
      d, k, 4, Tone.Synth,
      { oscillator: { type: 'square' }, envelope: { attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.12 }, volume: -10 },
      [new Tone.Filter(1600, 'lowpass')],
    ),
  sax: (d, k) =>
    held(
      d, k, 4, Tone.Synth,
      { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.03, decay: 0.15, sustain: 0.8, release: 0.15 }, volume: -10 },
      [new Tone.Filter({ frequency: 1500, type: 'lowpass', Q: 4 }), new Tone.Vibrato(4.5, 0.12)],
    ),
  trumpet: (d, k) => held(d, k, 4, Tone.MonoSynth, brass(450, 3).options),
  trombone: (d, k) => held(d, k, 3, Tone.MonoSynth, brass(250, 2.5).options),
  tuba: (d, k) => held(d, k, 2, Tone.MonoSynth, brass(120, 2).options),

  // Keys
  piano: (d, k) =>
    held(d, k, 4, Tone.Synth, {
      oscillator: { type: 'custom', partials: [1, 0.5, 0.25, 0.14, 0.07, 0.04] },
      envelope: { attack: 0.004, decay: 1.6, sustain: 0.12, release: 0.8 },
      volume: -6,
    }),
  organ: (d, k) =>
    held(d, k, 3, Tone.Synth, {
      oscillator: { type: 'custom', partials: [1, 0.7, 0.45, 0, 0.3, 0, 0, 0.18] },
      envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.08 },
      volume: -8,
    }),
  synth: (d, k) =>
    held(
      d, k, 4, Tone.Synth,
      { oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.3 }, volume: -8 },
      [new Tone.Filter({ frequency: 1400, type: 'lowpass', Q: 3 })],
    ),
}

export function create(instrumentId, destination, { key }) {
  const id = RECIPES[instrumentId] ? instrumentId : 'piano'
  return recordings[id] ? sampled(destination, id) : RECIPES[id](destination, key)
}
