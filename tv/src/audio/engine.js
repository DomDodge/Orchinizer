// Owns musical time. Every locked pattern is a looping one-bar Tone.Part on the
// Transport. Cues land on the next beat; all music-tied visuals go through Tone.Draw.
//
// A performance is { round, tempo, key, players: [{ seat, instrument, pattern }], events, endTick }.
// `events` is the replay log, sorted by tick:
//   { tick, beat, seat, type: 'cue', action: 'in' | 'out', id }
//   { tick, beat, seat, type: 'volume', level }
// Patterns + events are enough to replay a performance exactly.
import * as Tone from 'tone'
import { markRaw } from 'vue'
import { store, on } from '../state/store.js'
import { send } from '../net/socket.js'
import * as instruments from './instruments.js' // only via play / setVolume / dispose

if (import.meta.env.DEV) window.Tone = Tone // for poking at the Transport from devtools

const T = Tone.getTransport()
const Draw = Tone.getDraw()

let master = null // everything goes through this; muting sets it to 0 and timing carries on
let perf = null
let live = false
let voices = {} // seat -> { inst, part }

// Must be called from a click handler.
export function unlock() {
  return Tone.start().then(() => {
    master = new Tone.Gain(store.muted ? 0 : 1)
    master.chain(new Tone.Limiter(-1), Tone.getDestination())
  })
}

// Silences output without touching the Transport, so cues, bars and visuals keep running.
export function setMuted(muted) {
  store.muted = muted
  master?.gain.rampTo(muted ? 0 : 1, 0.05)
}

// Events reach the audio thread ~lookAhead early, so anything at or before this tick is
// already committed. The next beat after it is the earliest beat we can still change.
function nextBeatTick() {
  const committed = T.getTicksAtTime(Tone.now() + 0.06)
  return (Math.floor(committed / T.PPQ) + 1) * T.PPQ
}

function isOn(seat, tick) {
  let on = false
  for (const e of perf.events) {
    if (e.tick > tick) break
    if (e.seat === seat && e.type === 'cue') on = e.action === 'in'
  }
  return on
}

function insertEvent(e) {
  let i = perf.events.length
  while (i > 0 && perf.events[i - 1].tick > e.tick) i--
  perf.events.splice(i, 0, e)
}

// Applies a logged event when the Transport reaches it (cues always; volumes only in replay,
// since live volumes are applied the moment they arrive).
function scheduleEvent(e) {
  T.schedule((time) => {
    if (e.type === 'volume') {
      voices[e.seat]?.inst.setVolume(e.level, time)
    }
    Draw.schedule(() => {
      if (e.type === 'cue') {
        store.playing[e.seat] = e.action === 'in'
        store.lastCue = { seat: e.seat, action: e.action, beat: e.beat }
        console.log(`[audio] cue #${e.id} seat ${e.seat} ${e.action} landed on beat ${e.beat}`)
      } else {
        store.volumes[e.seat] = e.level
      }
    }, time)
  }, `${e.tick}i`)
}

function load(p) {
  teardown()
  perf = p
  T.bpm.value = p.tempo
  T.timeSignature = 4
  T.position = 0

  for (const pl of p.players) {
    const make = instruments[pl.instrument] || instruments.lead
    const inst = make(master, { key: p.key })

    // One event per step that has any lit rows. Step n is n eighth notes into the bar.
    const steps = []
    for (let step = 0; step < 8; step++) {
      const rows = [0, 1, 2, 3, 4].filter((r) => pl.pattern.grid[r]?.[step])
      if (rows.length) steps.push({ time: `0:${Math.floor(step / 2)}:${(step % 2) * 2}`, rows, step })
    }
    const part = new Tone.Part((time, ev) => {
      if (!isOn(pl.seat, Math.round(T.getTicksAtTime(time)))) return
      ev.rows.forEach((row) => inst.play(row, time))
    }, steps)
    part.loop = true
    part.loopEnd = '1m'
    part.start(0)
    voices[pl.seat] = { inst, part }
  }

  // Beat clock: drives beat dots / pulse and the per-bar message to phones.
  T.scheduleRepeat((time) => {
    const beat = Math.round(T.getTicksAtTime(time) / T.PPQ)
    Draw.schedule(() => {
      store.beat = beat
      if (beat % 4 === 0) {
        store.bar = beat / 4
        if (live) send('bar', { bar: store.bar, tempo: perf.tempo })
      }
    }, time)
  }, '4n', 0)

  p.events.forEach(scheduleEvent)
}

function teardown() {
  T.stop()
  T.cancel(0)
  Object.values(voices).forEach((v) => (v.part.dispose(), v.inst.dispose()))
  voices = {}
  store.playing = {}
  store.beat = -1
  store.bar = -1
}

function startLive(state) {
  const p = {
    round: state.round,
    tempo: state.tempo,
    key: state.key,
    players: state.players
      .filter((pl) => pl.seat !== state.conductor && pl.pattern)
      .map(({ seat, instrument, pattern }) => ({ seat, instrument, pattern })),
    events: [],
    endTick: null,
  }
  store.performances[p.round] = markRaw(p)
  live = true
  load(p)
  T.start('+0.1')
}

function stopLive() {
  perf.endTick = Math.round(T.ticks)
  live = false
  teardown()
}

on('state', (s) => {
  if (!master) return
  if (s.phase === 'perform' && !live) startLive(s)
  else if (s.phase !== 'perform' && live) stopLive()
})

on('cue', (msg) => {
  if (!live || !voices[msg.seat]) return
  const tick = nextBeatTick()
  const e = { tick, beat: tick / T.PPQ, seat: msg.seat, type: 'cue', action: msg.action, id: msg.id }
  insertEvent(e)
  scheduleEvent(e)
  send('cue_scheduled', { id: msg.id, beat: e.beat })
  console.log(`[audio] cue #${msg.id} seat ${msg.seat} ${msg.action} at beat ${(T.ticks / T.PPQ).toFixed(2)} -> beat ${e.beat}`)
})

on('volume', (msg) => {
  if (!live || !voices[msg.seat]) return
  // Heard at Tone.now(), so that's the tick we log.
  const tick = Math.round(T.getTicksAtTime(Tone.now()))
  voices[msg.seat].inst.setVolume(msg.level)
  insertEvent({ tick, beat: Math.floor(tick / T.PPQ), seat: msg.seat, type: 'volume', level: msg.level })
})
