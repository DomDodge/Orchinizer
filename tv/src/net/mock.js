// Fake server for ?mock=1. Same interface as the real socket: we get `send(msg)`,
// and it calls `deliver(msg)` with server messages shaped like /protocol (the real
// server's messages). Steps through every phase with 6 fake players and random patterns.
import { setConnection } from '../state/store.js'
import { MOCK_SPEED, SEAT_COLORS } from '../config.js'

const NAMES = ['Maya', 'Theo', 'Priya', 'Jonas', 'Lena', 'Kofi']
const INSTRUMENTS = ['contrabass', 'cello', 'viola', 'violin', 'harp', 'drums']
const KEYS = [['C', 96], ['G', 104], ['F', 88], ['D', 112], ['A', 100], ['Bb', 108]]
const ROUNDS = Number(new URLSearchParams(location.search).get('rounds')) || 3

// Base phase lengths in ms (scaled by ?speed=).
const LEN = { compose: 12000, calibrate: 7000, perform: 32000 }

const rand = (n) => Math.floor(Math.random() * n)
const pick = (a) => a[rand(a.length)]

function randomGrid(instrument) {
  const rows = instrument === 'drums' ? 3 : 5 // drums: kick, snare, hat
  const grid = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 8 }, () => r < rows && Math.random() < 0.25),
  )
  if (instrument === 'drums') grid[0][0] = grid[0][4] = true // keep a pulse
  return grid
}

// A note-editor part: held notes in 16th steps over a 2-bar (32-step) loop, never overlapping.
function randomNotes() {
  const notes = []
  for (let start = 0; start < 32; start += 4) {
    if (Math.random() < 0.35) continue
    notes.push({ id: `n${start}`, row: rand(5), start, length: 1 + rand(4) })
  }
  return notes
}

export function createMockServer(deliver) {
  const room = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rand(24)]).join('')
  let players = []
  let patterns = {} // seat -> grid (grid-sequencer phones)
  let notes = {} // seat -> notes (note-editor phones: the even seats here)
  let s = {} // phase, round, conductor, key, tempo, deadline, performances, winner, targets
  let timers = []
  let cueId = 0
  let nextPhase = null // what 'next'/'skip' (or the timer) moves to

  const later = (ms, fn) => timers.push(setTimeout(fn, ms * MOCK_SPEED))
  const every = (ms, fn) => timers.push(setInterval(fn, ms * MOCK_SPEED))
  const clear = () => {
    timers.forEach((t) => (clearTimeout(t), clearInterval(t)))
    timers = []
  }
  // Round-trip through JSON like a real socket, so no message shares objects with mock state.
  const emit = (type, data) => deliver(JSON.parse(JSON.stringify({ type, room, ...data })))
  const pushState = () =>
    emit('state', {
      phase: s.phase,
      round: s.round || 0,
      totalRounds: s.round ? ROUNDS : 0,
      conductor: s.conductor || 0,
      deadline: s.deadline || 0,
      serverTime: Date.now(),
      key: s.key || 'C',
      scale: 'major_pentatonic',
      tempo: s.tempo || 100,
      players,
      patterns,
      notes,
      performances: s.performances || [],
      winner: s.winner || 0,
      targets: s.targets || [],
    })
  const phase = (name, len, extra = {}) => {
    clear()
    Object.assign(s, { phase: name, deadline: len ? Date.now() + len * MOCK_SPEED : 0 }, extra)
    pushState()
  }
  const conductorFor = (round) => players[(round - 1) % players.length].seat
  const performers = () => players.filter((p) => p.seat !== s.conductor)

  function lobby() {
    s = { performances: [] }
    patterns = {}
    notes = {}
    nextPhase = null
    phase('lobby')
    if (players.length) return
    NAMES.forEach((name, i) =>
      later(700 * (i + 1), () => {
        players.push({
          seat: i + 1, name, color: SEAT_COLORS[i], instrument: INSTRUMENTS[i],
          connected: true, bot: false, noteCount: 0, playing: false,
        })
        pushState()
      }),
    )
  }

  function compose(round) {
    const [key, tempo] = pick(KEYS)
    patterns = {}
    notes = {}
    players.forEach((p) => (p.noteCount = 0))
    phase('compose', LEN.compose, { round, conductor: conductorFor(round), key, tempo })
    // Patterns are decided now; the TV only shows note counts until compose ends.
    const editor = (p) => p.seat % 2 === 0
    const hidden = Object.fromEntries(performers().filter((p) => !editor(p)).map((p) => [p.seat, randomGrid(p.instrument)]))
    const hiddenNotes = Object.fromEntries(performers().filter(editor).map((p) => [p.seat, randomNotes()]))
    every(400, () => {
      const p = pick(performers())
      const total = editor(p) ? hiddenNotes[p.seat].length : hidden[p.seat].flat().filter(Boolean).length
      p.noteCount = Math.min(total, p.noteCount + 1)
      pushState()
    })
    nextPhase = () => {
      patterns = hidden
      notes = hiddenNotes
      calibrate()
    }
    later(LEN.compose, nextPhase)
  }

  function calibrate() {
    phase('calibrate', LEN.calibrate)
    const seats = performers().map((p) => p.seat)
    seats.forEach((seat, i) => later((LEN.calibrate / (seats.length + 1)) * (i + 1), () => emit('select', { seat })))
    // Like the real server: one calibrated message, then perform right away.
    nextPhase = () => {
      emit('calibrated', { angles: Object.fromEntries(seats.map((seat, i) => [seat, i * 25])) })
      perform()
    }
    later(LEN.calibrate, nextPhase)
  }

  function perform() {
    // A cue chart like the server's: a prompt every 4 beats after a 2-bar lead-in.
    const beatMs = 60000 / s.tempo
    const seats = performers().map((p) => p.seat)
    s.targets = []
    for (let beat = 8, prev = 0; seats.length && beat <= (LEN.perform * MOCK_SPEED) / beatMs - 4; beat += 4) {
      let seat
      do seat = pick(seats)
      while (seat === prev && seats.length > 1)
      s.targets.push({ beat, seat, grade: '', points: 0 })
      prev = seat
    }
    phase('perform', LEN.perform)
    const playing = new Set()
    const cue = (seat, action) => {
      action === 'in' ? playing.add(seat) : playing.delete(seat)
      emit('cue', { id: `m${++cueId}`, seat, action })
    }
    // The fake conductor hits most prompts on time (real ms: the music doesn't speed up).
    // Grades are a dice roll here; the real server times the TV's cue_scheduled.
    for (const t of s.targets) {
      const roll = Math.random()
      if (roll < 0.2) continue
      timers.push(
        setTimeout(() => {
          cue(t.seat, playing.has(t.seat) && playing.size > 1 ? 'out' : 'in')
          Object.assign(t, roll < 0.65 ? { grade: 'perfect', points: 100 } : { grade: 'good', points: 50 })
          pushState()
        }, 100 + t.beat * beatMs),
      )
    }
    let pointed = seats[0]
    const level = Object.fromEntries(seats.map((x) => [x, 80]))
    every(100, () => {
      if (Math.random() < 0.03) pointed = pick(seats)
      emit('select', { seat: pointed })
      if (playing.has(pointed) && Math.random() < 0.5) {
        level[pointed] = Math.max(10, Math.min(100, level[pointed] + rand(21) - 10))
        emit('volume', { seat: pointed, level: level[pointed] })
      }
    })
    nextPhase = () => {
      const c = players.find((p) => p.seat === s.conductor)
      const count = (g) => s.targets.filter((t) => t.grade === g).length
      s.performances.push({
        round: s.round, conductorSeat: s.conductor, conductorName: c?.name || '', key: s.key, tempo: s.tempo,
        score: s.targets.reduce((sum, t) => sum + t.points, 0),
        perfect: count('perfect'), good: count('good'), miss: s.targets.length - count('perfect') - count('good'),
      })
      s.targets = []
      s.round < ROUNDS ? compose(s.round + 1) : results()
    }
    later(LEN.perform, nextPhase)
  }

  function results() {
    const winner = s.performances.reduce((a, b) => (b.score > a.score ? b : a)).round
    phase('results', null, { winner, conductor: 0 })
    nextPhase = lobby
  }

  // Returning "connected" right away mirrors the real socket's onopen + join.
  setConnection('open')
  emit('welcome', { role: 'tv', seat: 0, token: 'mock' })
  lobby()

  return {
    send(msg) {
      if (msg.type !== 'host_action') return
      if (msg.action === 'restart') lobby()
      else if (msg.action === 'start' && s.phase === 'lobby') compose(1)
      else if ((msg.action === 'next' || msg.action === 'skip') && nextPhase) nextPhase()
    },
  }
}
