// Owns musical time. Every locked pattern is a looping one-bar Tone.Part on the
// Transport. Cues land on the next beat; all music-tied visuals go through Tone.Draw.
//
// A performance is { round, tempo, key, players: [{ seat, instrument, pattern }], events }.
// `events` is the cue/volume log, sorted by tick:
//   { tick, beat, seat, type: 'cue', action: 'in' | 'out', id }
//   { tick, beat, seat, type: 'volume', level }
import * as Tone from 'tone'
import * as store from '../state/store.js'
import { send } from '../net/socket.js'
import * as instruments from './instruments.js' // only via play / setVolume / dispose
import { partNotes, STEPS_PER_BEAT } from './part.js'
import lobbyMusicUrl from './music/lobby.mp3'

if (import.meta.env.DEV) window.Tone = Tone // for poking at the Transport from devtools


const T = Tone.getTransport()
const Draw = Tone.getDraw()

let master = null // everything goes through this; muting sets it to 0 and timing carries on
let perf = null
let live = false
let voices = {} // seat -> { insts: { instrument: inst }, part, setVolume(level, time?) }

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

// Applies a logged cue when the Transport reaches it. (Live volumes are applied the moment
// they arrive, so they're only logged.)
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
      insts[name] = instruments.create(name, master, { key: p.key })
    }

    // One event per step that has notes on it.
    const byStart = new Map()
    for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) || []), n])
    const events = [...byStart].map(([start, ns]) => ({ time: `${start * ticksPerStep}i`, notes: ns }))
    const part = new Tone.Part((time, ev) => {
      if (!isOn(pl.seat, Math.round(T.getTicksAtTime(time)))) return
      for (const n of ev.notes) {
        const dur = Tone.Ticks(n.length * ticksPerStep).toSeconds()
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
  const p = {
    round: state.round,
    tempo: state.tempo,
    key: state.key,
    players: state.players
      .filter((pl) => pl.seat !== state.conductor && pl.pattern)
      .map(({ seat, instrument, pattern }) => ({ seat, instrument, pattern })),
    events: [],
  }
  live = true
  load(p)
  T.start('+0.1')
}

function stopLive() {
  live = false
  teardown()
}

store.on('state', (s) => {
  if (!master) return
  setLobbyMusic(s.phase === 'lobby')
  if (s.phase === 'perform' && !live) startLive(s)
  else if (s.phase !== 'perform' && live) stopLive()
})

// ---- lobby music ----

// Loops while the lobby is on screen. It goes through `master`, so the lobby's mute button
// silences it too, and it runs on its own clock, not the Transport, so the show can't stop it.
let lobbyMusic = null // created on first use, once audio is unlocked
let wantLobbyMusic = false

function setLobbyMusic(on) {
  wantLobbyMusic = on
  if (!lobbyMusic) {
    if (!on) return
    lobbyMusic = new Tone.Player({
      url: lobbyMusicUrl,
      loop: true,
      fadeIn: 1,
      fadeOut: 1,
      volume: -6,
      // The file loads in the background; start it then if the lobby is still up.
      onload: () => wantLobbyMusic && lobbyMusic.start(),
    }).connect(master)
    return
  }
  if (!lobbyMusic.loaded) return // onload will start it if needed
  if (on && lobbyMusic.state !== 'started') lobbyMusic.start()
  else if (!on && lobbyMusic.state === 'started') lobbyMusic.stop()
}

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
