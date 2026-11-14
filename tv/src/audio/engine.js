// Owns musical time. In perform the Transport runs the song (the shared sheet) from step 0,
// lined up with the server's clock, but nothing plays on its own: a note sounds only when
// the conductor cues its seat close enough to it. All music-tied visuals go through Tone.Draw.
//
// A performance is { round, tempo, key, start, players: [{ seat, instrument, pattern }] }.
import * as Tone from 'tone'
import * as store from '../state/store.js'
import { send } from '../net/socket.js'
import * as instruments from './instruments.js' // only via play / setVolume / dispose
import { partNotes, STEPS_PER_BEAT } from './part.js'
import lobbyMusicUrl from './music/lobby.mp3'

const HIT_WINDOW_MS = 300 // /protocol ScoreHitWindowMS

if (import.meta.env.DEV) window.Tone = Tone // for poking at the Transport from devtools


const T = Tone.getTransport()
const Draw = Tone.getDraw()

let master = null // everything goes through this; muting sets it to 0 and timing carries on
let perf = null
let live = false
let voices = {} // seat -> { insts: { instrument: inst }, instrument, notes, setVolume(level, time?) }

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

// For visuals that move continuously (falling notes): the Transport position of what's
// being heard right now. Reading the audio clock each frame keeps them locked to the sound.
export function timeline() {
  return {
    running: !!perf && T.state === 'started',
    tick: T.getTicksAtTime(Tone.immediate()),
    ppq: T.PPQ,
  }
}

// A seat's song notes, each { row, start, length, instrument, tick, played }, for the lanes.
export const seatNotes = (seat) => voices[seat]?.notes || []

function load(p) {
  teardown()
  perf = p
  T.bpm.value = p.tempo
  T.timeSignature = 4
  T.position = 0

  const ticksPerStep = T.PPQ / STEPS_PER_BEAT
  for (const pl of p.players) {
    // Held notes, optionally a different instrument per note. Nothing is scheduled: notes
    // play from the 'cue' handler below.
    const { notes } = partNotes(pl.pattern)
    const insts = {}
    for (const name of new Set([pl.instrument, ...notes.map((n) => n.instrument || pl.instrument)])) {
      insts[name] = instruments.create(name, master, { key: p.key })
    }
    voices[pl.seat] = {
      insts,
      instrument: pl.instrument,
      notes: notes.map((n) => ({ ...n, tick: n.start * ticksPerStep, played: false })),
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
}

function teardown() {
  T.stop()
  T.cancel(0)
  Object.values(voices).forEach((v) => Object.values(v.insts).forEach((i) => i.dispose()))
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
  }
  live = true
  load(p)
  // Step 0 of the song is the server's scoring.start, so the lanes land notes when the
  // server judges them. Joining late (or a reload) starts mid-song.
  const start = state.scoring?.start
  const elapsed = start ? (Date.now() - state.serverOffset - start) / 1000 : 0
  T.start('+0.05', Math.max(0, elapsed + 0.05))
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

// The conductor played a seat: sound that seat's unplayed note nearest to now, if one is
// within the hit window. The server scores the same cue; this is only the sound.
store.on('cue', (msg) => {
  const v = live && voices[msg.seat]
  if (!v) return
  const tick = T.getTicksAtTime(Tone.immediate())
  const window = (HIT_WINDOW_MS / 1000) * (T.bpm.value / 60) * T.PPQ
  let best = null
  for (const n of v.notes) {
    if (!n.played && Math.abs(n.tick - tick) <= window && (!best || Math.abs(n.tick - tick) < Math.abs(best.tick - tick))) best = n
  }
  if (!best) return console.log(`[audio] cue #${msg.id} seat ${msg.seat}: no note near beat ${(tick / T.PPQ).toFixed(2)}`)
  best.played = true
  const dur = Tone.Ticks(best.length * (T.PPQ / STEPS_PER_BEAT)).toSeconds()
  const now = Tone.now()
  v.insts[best.instrument || v.instrument].play(best.row, now, dur)
  Draw.schedule(() => store.notePlayed(msg.seat, true), now)
  Draw.schedule(() => store.notePlayed(msg.seat, false), now + dur)
})

store.on('volume', (msg) => {
  if (!live || !voices[msg.seat]) return
  voices[msg.seat].setVolume(msg.level)
})
