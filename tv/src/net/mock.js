// Fake server for ?mock=1. Same interface as the real socket: we get `send(msg)`,
// and it calls `deliver(msg)` with server messages. Steps through every phase
// with 6 fake players and random patterns.
import { setConnection } from '../state/store.js'
import { MOCK_SPEED, SEAT_COLORS } from '../config.js'

const NAMES = ['Maya', 'Theo', 'Priya', 'Jonas', 'Lena', 'Kofi']
const INSTRUMENTS = ['bass', 'pad', 'lead', 'drums']
const KEYS = ['C', 'D', 'E', 'G', 'A']
const ROUNDS = Number(new URLSearchParams(location.search).get('rounds')) || 3

// Base phase lengths in ms (scaled by ?speed=).
const LEN = { compose: 12000, calibrate: 7000, perform: 32000, next_round: 3000, votePerRound: 10000 }

const rand = (n) => Math.floor(Math.random() * n)
const pick = (a) => a[rand(a.length)]

function randomPattern(instrument) {
  const rows = instrument === 'drums' ? 3 : 5 // drums: kick, snare, hat
  const grid = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 8 }, () => r < rows && Math.random() < (instrument === 'pad' ? 0.12 : 0.25)),
  )
  if (instrument === 'drums') grid[0][0] = grid[0][4] = true // keep a pulse
  return { instrument, grid }
}

export function createMockServer(deliver) {
  const room = Array.from({ length: 4 }, () => String.fromCharCode(65 + rand(26))).join('')
  let players = []
  let s = {} // phase, round, conductor, key, tempo, deadline, history, votes, winner
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
  const pushState = () => emit('state', { ...s, players })
  const phase = (name, len, extra = {}) => {
    clear()
    Object.assign(s, { phase: name, deadline: len ? Date.now() + len * MOCK_SPEED : null }, extra)
    pushState()
  }
  const conductorFor = (round) => players[(round - 1) % players.length].seat
  const performers = () => players.filter((p) => p.seat !== s.conductor)

  function lobby() {
    s = { history: [], votes: {} }
    nextPhase = null
    phase('lobby')
    if (players.length) return
    NAMES.forEach((name, i) =>
      later(700 * (i + 1), () => {
        players.push({ seat: i + 1, name, color: SEAT_COLORS[i], instrument: INSTRUMENTS[i % 4], pattern: null })
        pushState()
      }),
    )
  }

  function compose(round) {
    const key = pick(KEYS)
    const tempo = 90 + rand(31)
    players.forEach((p) => (p.pattern = null))
    phase('compose', LEN.compose, { round, conductor: conductorFor(round), key, tempo })
    // Patterns are decided now but only counts leak out until compose ends.
    const hidden = Object.fromEntries(performers().map((p) => [p.seat, randomPattern(p.instrument)]))
    const counts = {}
    every(400, () => {
      const p = pick(performers())
      const total = hidden[p.seat].grid.flat().filter(Boolean).length
      counts[p.seat] = Math.min(total, (counts[p.seat] || 0) + 1)
      emit('compose_progress', { seat: p.seat, notes: counts[p.seat] })
    })
    nextPhase = () => {
      performers().forEach((p) => (p.pattern = hidden[p.seat]))
      calibrate()
    }
    later(LEN.compose, nextPhase)
  }

  function calibrate() {
    phase('calibrate', LEN.calibrate, { calibrated: [] })
    const seats = performers().map((p) => p.seat)
    const done = []
    seats.forEach((seat, i) =>
      later((LEN.calibrate / (seats.length + 1)) * (i + 1), () => {
        emit('select', { seat })
        done.push(seat)
        emit('calibrated', { seats: [...done] })
      }),
    )
    nextPhase = perform
    later(LEN.calibrate, perform)
  }

  function perform() {
    phase('perform', LEN.perform, { calibrated: undefined })
    const seats = performers().map((p) => p.seat)
    const playing = new Set()
    const cue = (seat, action) => {
      action === 'in' ? playing.add(seat) : playing.delete(seat)
      emit('cue', { id: ++cueId, seat, action })
    }
    later(500, () => cue(seats[0], 'in'))
    later(900, () => cue(seats[1], 'in'))
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
    every(2200, () => {
      const seat = pick(seats)
      cue(seat, playing.has(seat) && playing.size > 1 ? 'out' : 'in')
    })
    nextPhase = () => {
      s.history.push({ round: s.round, conductor: s.conductor, key: s.key, tempo: s.tempo })
      s.round < ROUNDS ? nextRound() : vote()
    }
    later(LEN.perform, nextPhase)
  }

  function nextRound() {
    const round = s.round + 1
    phase('next_round', LEN.next_round, { round, conductor: conductorFor(round), key: pick(KEYS), tempo: 90 + rand(31) })
    nextPhase = () => compose(round)
    later(LEN.next_round, nextPhase)
  }

  function vote() {
    // Not shortened by ?speed=: replay clips always take a real 10 s each.
    const len = (LEN.votePerRound * s.history.length + 5000) / MOCK_SPEED
    phase('vote', len, { votes: Object.fromEntries(s.history.map((h) => [h.round, 0])) })
    every(1500, () => {
      const r = pick(s.history).round
      s.votes = { ...s.votes, [r]: s.votes[r] + 1 }
      emit('votes', { votes: s.votes })
    })
    nextPhase = results
    later(len, results)
  }

  function results() {
    const winner = s.history.reduce((a, b) => (s.votes[b.round] > s.votes[a.round] ? b : a)).round
    phase('results', null, { winner })
    nextPhase = lobby
  }

  // Returning "connected" right away mirrors the real socket's onopen + join.
  setConnection('open')
  lobby()

  return {
    send(msg) {
      if (msg.type !== 'host_action') return
      if (msg.action === 'start' && (s.phase === 'lobby' || s.phase === 'results')) {
        s.history = []
        s.votes = {}
        compose(1)
      } else if ((msg.action === 'next' || msg.action === 'skip') && nextPhase) {
        nextPhase()
      }
    },
  }
}
