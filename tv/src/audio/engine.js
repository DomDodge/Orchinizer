// Owns musical time. Every locked pattern is a looping one-bar Tone.Part on the
// Transport. Cues land on the next beat; all music-tied visuals go through Tone.Draw.
//
// A performance is { round, tempo, key, players: [{ seat, instrument, pattern }], events, endTick }.
// `events` is the replay log, sorted by tick:
//   { tick, beat, seat, type: 'cue', action: 'in' | 'out', id }
//   { tick, beat, seat, type: 'volume', level }
// Patterns + events are enough to replay a performance exactly.
import * as Tone from 'tone'
import * as store from '../state/store.js'
import { send } from '../net/socket.js'
import * as instruments from './instruments.js' // only via play / setVolume / dispose
import { partNotes, STEPS_PER_BEAT } from './part.js'

if (import.meta.env.DEV) window.Tone = Tone // for poking at the Transport from devtools

// The server's instruments (see /protocol INSTRUMENT_GROUPS) mapped onto our synth voices.
const VOICE = {
  contrabass: 'bass', cello: 'bass', viola: 'pad', violin: 'lead', harp: 'lead', guitar: 'lead',
  flute: 'lead', clarinet: 'lead', sax: 'lead', trumpet: 'lead', trombone: 'bass', tuba: 'bass',
  drums: 'drums', timpani: 'drums', xylophone: 'lead', bongos: 'drums',
  piano: 'lead', organ: 'pad', synth: 'pad',
}
const voiceFor = (instrument) => instruments[VOICE[instrument] || instrument] || instruments.lead

const T = Tone.getTransport()
const Draw = Tone.getDraw()

let master = null // everything goes through this; muting sets it to 0 and timing carries on
let perf = null
let live = false
let voices = {} // seat -> { insts: { instrument: inst }, part, setVolume(level, time?) }
let replaying = null // { fromTick, toTick, resolve } while a replay runs

// Must be called from a click handler.
export function unlock() {
  return Tone.start().then(() => {
    master = new Tone.Gain(store.getState().muted ? 0 : 1)
    master.chain(new Tone.Limiter(-1), Tone.getDestination())
  })
}

// Silences output without touching the Transport, so cues, bars and visuals keep running.
export function setMuted(muted) {
  store.setMuted(muted)
  master?.gain.rampTo(muted ? 0 : 1, 0.05)
}

// Events reach the audio thread ~lookAhead early, so anything at or before this tick is
// already committed. The next beat after it is the earliest beat we can still change.
function nextBeatTick() {
  const committed = T.getTicksAtTime(Tone.now() + 0.06)
  return (Math.floor(committed / T.PPQ) + 1) * T.PPQ
}

// For visuals that move continuously (falling notes): the Transport position of what's
// being heard right now. Reading the audio clock each frame keeps them locked to the sound.
export function timeline() {
  return {
    running: !!perf && T.state === 'started',
    tick: T.getTicksAtTime(Tone.immediate()),
    ppq: T.PPQ,
  }
}

// Whether a seat's part is (or, for already-scheduled cues, will be) playing at `tick`.
export function seatOn(seat, tick) {
  return !!perf && isOn(seat, tick)
}

function isOn(seat, tick, events = perf.events) {
  let on = false
  for (const e of events) {
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
      voices[e.seat]?.setVolume(e.level, time)
    }
    Draw.schedule(() => {
      if (e.type === 'cue') {
        store.setCue(e.seat, e.action, e.beat)
        if (live) console.log(`[audio] cue #${e.id} seat ${e.seat} ${e.action} landed on beat ${e.beat}`)
      } else {
        store.setVolume(e.seat, e.level)
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

  const ticksPerStep = T.PPQ / STEPS_PER_BEAT
  for (const pl of p.players) {
    // Grid parts loop every bar in 8ths; note-editor parts every 2 bars in 16ths, with
    // held notes and optionally a different instrument per note. partNotes unifies them.
    const { loopSteps, notes } = partNotes(pl.pattern)
    const insts = {}
    for (const name of new Set([pl.instrument, ...notes.map((n) => n.instrument || pl.instrument)])) {
      insts[name] = voiceFor(name)(master, { key: p.key })
    }

    // One event per step that has notes on it.
    const byStart = new Map()
    for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) || []), n])
    const events = [...byStart].map(([start, ns]) => ({ time: `${start * ticksPerStep}i`, notes: ns }))
    const part = new Tone.Part((time, ev) => {
      if (!isOn(pl.seat, Math.round(T.getTicksAtTime(time)))) return
      for (const n of ev.notes) {
        const dur = n.fromGrid ? undefined : Tone.Ticks(n.length * ticksPerStep).toSeconds()
        insts[n.instrument || pl.instrument].play(n.row, time, dur)
      }
      Draw.schedule(() => store.bumpHit(pl.seat), time)
    }, events)
    part.loop = true
    part.loopEnd = `${loopSteps * ticksPerStep}i`
    part.start(0)
    voices[pl.seat] = {
      insts,
      part,
      setVolume: (level, t) => Object.values(insts).forEach((i) => i.setVolume(level, t)),
    }
  }

  // Beat clock: drives beat dots / pulse and the per-bar message to phones.
  T.scheduleRepeat((time) => {
    const beat = Math.round(T.getTicksAtTime(time) / T.PPQ)
    Draw.schedule(() => {
      store.setBeat(beat)
      if (beat % 4 === 0 && live) send('bar', { bar: beat / 4, tempo: perf.tempo })
    }, time)
  }, '4n', 0)

  p.events.forEach(scheduleEvent)
}

function teardown() {
  T.stop()
  T.cancel(0)
  Object.values(voices).forEach((v) => (v.part.dispose(), Object.values(v.insts).forEach((i) => i.dispose())))
  voices = {}
  store.resetPlayback()
}

function startLive(state) {
  finishReplay(false)
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
  store.savePerformance(p)
  live = true
  load(p)
  T.start('+0.1')
}

function stopLive() {
  perf.endTick = Math.round(T.ticks)
  live = false
  teardown()
}

store.on('state', (s) => {
  if (!master) return
  if (s.phase === 'perform' && !live) startLive(s)
  else if (s.phase !== 'perform' && live) stopLive()
})

store.on('cue', (msg) => {
  if (!live || !voices[msg.seat]) return
  const tick = nextBeatTick()
  const e = { tick, beat: tick / T.PPQ, seat: msg.seat, type: 'cue', action: msg.action, id: msg.id }
  insertEvent(e)
  scheduleEvent(e)
  send('cue_scheduled', { id: msg.id, seat: msg.seat, action: msg.action, beat: e.beat })
  console.log(`[audio] cue #${msg.id} seat ${msg.seat} ${msg.action} at beat ${(T.ticks / T.PPQ).toFixed(2)} -> beat ${e.beat}`)
})

store.on('volume', (msg) => {
  if (!live || !voices[msg.seat]) return
  // Heard at Tone.now(), so that's the tick we log.
  const tick = Math.round(T.getTicksAtTime(Tone.now()))
  voices[msg.seat].setVolume(msg.level)
  insertEvent({ tick, beat: Math.floor(tick / T.PPQ), seat: msg.seat, type: 'volume', level: msg.level })
})

// ---- replays ----

// The server sends every performance (patterns + cue log) when the vote starts. Normally we
// recorded them ourselves; this fills in any we missed, e.g. after the TV page reloaded.
store.on('performances', (msg) => {
  const have = store.getState().performances
  for (const sp of msg.list || []) {
    if (have[sp.round]) continue
    const ppq = T.PPQ
    const events = (sp.cues || []).map((c) => ({ tick: c.beat * ppq, beat: c.beat, seat: c.seat, type: 'cue', action: c.action, id: c.id }))
    const lastBeat = events.length ? events[events.length - 1].beat : 0
    store.savePerformance({
      round: sp.round,
      tempo: sp.tempo,
      key: sp.key,
      players: (sp.parts || []).map((pt) => ({
        seat: pt.seat,
        instrument: pt.instrument,
        pattern: { instrument: pt.instrument, grid: pt.steps, notes: pt.notes },
      })),
      events,
      endTick: (lastBeat + 16) * ppq, // the log has no end marker; play 4 bars past the last cue
    })
  }
})

// Picks the `seconds`-long window (starting on a bar line) with the most parts playing.
export function bestClip(p, seconds = 10) {
  const ppq = T.PPQ
  const len = Math.round(((seconds * p.tempo) / 60) * ppq)
  const end = p.endTick || 0
  if (end <= len) return { fromTick: 0, toTick: Math.max(end, 1) }
  const seats = p.players.map((pl) => pl.seat)
  let best = 0
  let bestScore = -1
  for (let from = 0; from + len <= end; from += 4 * ppq) {
    const score = seats.filter((s) => isOn(s, from + len / 2, p.events)).length
    if (score > bestScore) [best, bestScore] = [from, score]
  }
  return { fromTick: best, toTick: best + len }
}

// Plays a recorded performance from its patterns + log, exactly as it happened.
// Resolves true when the clip ends, false if it was stopped early.
export function replay(p, { fromTick = 0, toTick = p.endTick } = {}) {
  finishReplay(false)
  if (!master || !p || !(toTick > fromTick)) return Promise.resolve(false)
  live = false
  load(p)

  // Recreate the state at fromTick: who was playing and at what volume.
  const playing = {}
  const volumes = {}
  for (const e of p.events) {
    if (e.tick > fromTick) break
    if (e.type === 'cue') playing[e.seat] = e.action === 'in'
    else volumes[e.seat] = e.level
  }
  Object.entries(volumes).forEach(([seat, level]) => voices[seat]?.setVolume(level))
  store.setReplayState(playing, volumes)

  return new Promise((resolve) => {
    replaying = { fromTick, toTick, resolve }
    T.schedule((time) => Draw.schedule(() => finishReplay(true), time), `${toTick}i`)
    T.start('+0.1', `${fromTick}i`)
  })
}

export const stopReplay = () => finishReplay(false)

function finishReplay(completed) {
  const r = replaying
  if (!r) return
  replaying = null
  teardown()
  r.resolve(completed)
}

// 0..1 through the current replay (read it every frame), or null when nothing is replaying.
export function replayProgress() {
  if (!replaying) return null
  const tick = T.getTicksAtTime(Tone.immediate())
  return Math.min(1, Math.max(0, (tick - replaying.fromTick) / (replaying.toTick - replaying.fromTick)))
}
