// Fake server for ?mock=1. Same interface as the real socket: we get `send(msg)`,
// and it calls `deliver(msg)` with server messages shaped like /protocol (the real
// server's messages). Steps through every phase with 6 fake players and random patterns.
import { setConnection } from '../state/store.js'
import { MOCK_SPEED, SEAT_COLORS } from '../config.js'

const NAMES = ['Maya', 'Theo', 'Priya', 'Jonas', 'Lena', 'Kofi']
const INSTRUMENTS = ['contrabass', 'cello', 'viola', 'violin', 'guitar', 'flute']
const KEYS = [['C', 96], ['G', 104], ['F', 88], ['D', 112], ['A', 100], ['Bb', 108]]
const ROUNDS = Number(new URLSearchParams(location.search).get('rounds')) || 3

// Base phase lengths in ms (scaled by ?speed=).
const LEN = { compose: 12000, calibrate: 7000, perform: 45000 }

const rand = (n) => Math.floor(Math.random() * n)
const pick = (a) => a[rand(a.length)]

// A part on the shared sheet (16 bars of 16th steps). Players take turns owning 8-step slots,
// so parts never clash, like the real server's rule: notes never overlap and rest 1 step apart.
function randomNotes(index, count) {
  const notes = []
  for (let slot = index; slot * 8 < 256 && notes.length < 16; slot += count) {
    if (Math.random() < 0.3) continue
    notes.push({ id: `n${slot}`, row: rand(5), start: slot * 8, length: 1 + rand(7) })
  }
  return notes
}

export function createMockServer(deliver) {
  const room = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rand(24)]).join('')
  let players = []
  let patterns = {} // seat -> grid; always empty now that everyone writes on the shared sheet
  let notes = {} // seat -> notes (note-editor phones: the even seats here)
  let s = {} // phase, round, conductor, key, tempo, deadline, performances, winner
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
      scoring: s.phase === 'perform' ? s.scoring : undefined,
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
          connected: true, bot: false, noteCount: 0, level: 80,
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
    // Parts are decided now; the TV only shows note counts until compose ends.
    const band = performers()
    const hiddenNotes = Object.fromEntries(band.map((p, i) => [p.seat, randomNotes(i, band.length)]))
    every(400, () => {
      const p = pick(band)
      p.noteCount = Math.min(hiddenNotes[p.seat].length, p.noteCount + 1)
      pushState()
    })
    nextPhase = () => {
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
    // The chart, like the server's: every note of the song, in order, on its seat; notes
    // 4+ steps long are holds. Notes too late to judge before perform ends are left off.
    const stepMs = 60000 / s.tempo / 4
    const start = Date.now()
    const end = start + LEN.perform * MOCK_SPEED
    const seats = performers().map((p) => p.seat)
    const song = Object.entries(notes)
      .flatMap(([seat, ns]) => ns.map((n) => ({ seat: Number(seat), ...n })))
      .sort((a, b) => a.start - b.start || a.seat - b.seat)
    const targets = []
    for (const n of song) {
      const at = start + n.start * stepMs
      if (at + 300 >= end) break
      const t = { id: targets.length + 1, kind: 'flick', seat: n.seat, at, result: 'pending' }
      if (n.length >= 4) Object.assign(t, { kind: 'hold', end: Math.min(at + n.length * stepMs, end) })
      targets.push(t)
    }
    s.scoring = { start, summary: { points: 0, maxCombo: 0, perfect: 0, good: 0, misses: 0, total: targets.length }, combo: 0, targets }
    phase('perform', LEN.perform)
    // The fake conductor plays most notes (real ms: the music doesn't speed up). Grades are
    // a dice roll; the real server judges cue arrival times. No combo multiplier here.
    const sum = s.scoring.summary
    for (const t of targets) {
      const roll = Math.random()
      if (roll >= 0.2) timers.push(setTimeout(() => emit('cue', { id: `m${++cueId}`, seat: t.seat }), t.at - start))
      timers.push(
        setTimeout(() => {
          t.result = roll < 0.2 ? 'miss' : roll < 0.65 ? 'perfect' : 'good'
          const points = { perfect: 100, good: 50, miss: 0 }[t.result]
          s.scoring.combo = t.result === 'miss' ? 0 : s.scoring.combo + 1
          sum.maxCombo = Math.max(sum.maxCombo, s.scoring.combo)
          sum.points += points
          t.result === 'miss' ? sum.misses++ : sum[t.result]++
          s.scoring.last = { targetId: t.id, result: t.result, points, at: Date.now() }
          pushState()
        }, (t.end || t.at) - start),
      )
    }
    let pointed = seats[0]
    const level = Object.fromEntries(seats.map((x) => [x, 80]))
    every(100, () => {
      if (Math.random() < 0.03) pointed = pick(seats)
      emit('select', { seat: pointed })
      if (Math.random() < 0.2) {
        level[pointed] = Math.max(10, Math.min(100, level[pointed] + rand(21) - 10))
        emit('volume', { seat: pointed, level: level[pointed] })
      }
    })
    nextPhase = () => {
      const c = players.find((p) => p.seat === s.conductor)
      for (const t of targets) if (t.result === 'pending') (t.result = 'miss'), sum.misses++
      s.performances.push({ round: s.round, conductorSeat: s.conductor, conductorName: c?.name || '', key: s.key, tempo: s.tempo, score: { ...sum } })
      s.round < ROUNDS ? compose(s.round + 1) : results()
    }
    later(LEN.perform, nextPhase)
  }

  function results() {
    const pts = (pf) => pf.score?.points ?? 0
    const winner = s.performances.reduce((a, b) => (pts(b) > pts(a) ? b : a)).round
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
