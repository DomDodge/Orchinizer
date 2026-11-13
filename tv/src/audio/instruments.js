// Synth sounds, one recipe per instrument. engine.js only depends on the interface below.
//
//   const inst = create(instrument, destination, { key })
//     instrument   the server's instrument id, e.g. 'violin' (see /protocol INSTRUMENT_GROUPS).
//                  Unknown ids get the piano.
//     destination  Tone.js node to connect your output to (the engine's master bus).
//     key          the round's key as a note name, e.g. 'C', 'Bb'.
//
//   inst.play(row, time, duration)
//     row       0-4, the row of one note (0 = lowest). Drum kits (drums, timpani, bongos)
//               use rows 0-2 only.
//     time      exact AudioContext time to sound the note. Always pass it through to
//               triggerAttack*/start(); never play "now", or it drifts off the beat.
//     duration  seconds the note is held (a stretched note is longer). Plucked and struck
//               instruments ring out on their own and ignore it.
//   inst.play(row, time, duration?)
//     row   0-4, the grid row of one lit cell (0 = lowest). For drums: 0 kick, 1 snare,
//           2 hat; rows 3-4 are unused. If several rows are lit on a step, play() is
//           called once per row with the same time.
//     time  exact AudioContext time to sound the note. Always pass it through to
//           triggerAttack*/start(); never play "now", or it drifts off the beat.
//     duration  seconds to hold the note (note-editor parts can stretch notes). Omitted
//           for grid parts: use the instrument's natural length. Drums ignore it.
//
//   inst.setVolume(level, time?)
//     level 0-100 from the conductor. `time` is when the change should be heard
//     (omitted = right away). Called often (up to 10/s), so ramp rather than jump.
//
//   inst.dispose()
//     free every node; called when the performance ends.
//
// Each player gets their own instance, so two of the same instrument never share state.
// Pitch: the five rows are the major pentatonic of the round's key; see `notesFor`.
// The phone's preview samples (app/Orchinizer/scripts/gen-sounds.mjs) mimic these recipes and
// use the same octaves, so keep the two in step when changing a sound.
import * as Tone from 'tone'

const PENTATONIC = [0, 2, 4, 7, 9] // semitones above the root; row n plays PENTATONIC[n]

export function notesFor(key, octave) {
  const root = Tone.Frequency(`${key}${octave}`).toMidi()
  return PENTATONIC.map((i) => Tone.Frequency(root + i, 'midi').toNote())
}

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

export function bass(destination, { key }) {
  const notes = notesFor(key, 2)
  // Poly, because play() can be called for several rows at the same time.
  const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' } })
  return withVolume(destination, [synth], (row, time, dur) => synth.triggerAttackRelease(notes[row], dur || '8n', time))
}

export function pad(destination, { key }) {
  const notes = notesFor(key, 3)
  const synth = new Tone.PolySynth(Tone.Synth, { volume: -10 })
  return withVolume(destination, [synth], (row, time, dur) => synth.triggerAttackRelease(notes[row], dur || '4n', time))
}

export function lead(destination, { key }) {
  const notes = notesFor(key, 4)
  const synth = new Tone.PolySynth(Tone.Synth, { volume: -6 })
  return withVolume(destination, [synth], (row, time, dur) => synth.triggerAttackRelease(notes[row], dur || '16n', time))
}

export function create(instrumentId, destination, { key }) {
  return (RECIPES[instrumentId] || RECIPES.piano)(destination, key)
}
