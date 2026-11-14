// Plain-JS store, no framework imports. `getState()` returns an immutable snapshot that is
// replaced on every change, so React's useSyncExternalStore (see useGameState.js) can
// compare by reference. Only the update functions below change it.
//
// `game` is the latest full server `state` message; the rest are live events between snapshots.

let state = {
  connection: 'idle', // idle | connecting | open | reconnecting
  room: null,
  token: null, // from welcome; proves this tab is the room's TV when reconnecting
  error: null, // last server error { message, at }
  game: null,
  selected: null, // seat the conductor is pointing at
  volumes: {}, // seat -> 0..100
  playing: {}, // seat -> true; set by the audio engine when a cue actually lands
  lastCue: null, // { seat, action, beat }
  calibrated: [], // seats calibrated so far
  noteCounts: {}, // seat -> notes placed during compose (counts only, never the notes)
  hits: {}, // seat -> notes played so far (bumped via Tone.Draw); drives seat flashes
  phaseStartedAt: 0, // when the current phase began, for countdown rings
  beat: -1, // current beat, updated via Tone.Draw
  bar: -1,
  muted: new URLSearchParams(location.search).get('mute') === '1', // ?mute=1 starts silent
  messages: [], // last 10 received, newest first (debug overlay)
}

const subscribers = new Set()
const listeners = {}

export const getState = () => state

export function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

function set(patch) {
  state = { ...state, ...patch }
  subscribers.forEach((fn) => fn())
}

// Let other modules (audio) react to specific message types.
export function on(type, fn) {
  ;(listeners[type] ||= new Set()).add(fn)
  return () => listeners[type].delete(fn)
}

// ---- server messages ----

// Converts the server's `state` (see /protocol) into the shape the screens use:
//   players[].pattern = { instrument, grid, notes } once patterns lock (calibrate/perform), else null.
//     `notes` is set for phones using the note editor; audio/part.js reads either form.
//   history = finished rounds [{ round, conductor, conductorName, key, tempo, score }]
//   deadline = moved onto this machine's clock using serverTime, so a wrong TV clock doesn't matter
function fromServerState(msg, prev) {
  const locked = msg.phase === 'calibrate' || msg.phase === 'perform'
  const patterns = msg.patterns || {}
  const notes = msg.notes || {}
  const players = (msg.players || []).map((p) => ({
    ...p,
    pattern:
      locked && p.seat !== msg.conductor && (patterns[p.seat] || notes[p.seat])
        ? { instrument: p.instrument, grid: patterns[p.seat] || [], notes: notes[p.seat] }
        : null,
  }))
  const history = (msg.performances || []).map((pf) => ({
    round: pf.round,
    conductor: pf.conductorSeat,
    conductorName: pf.conductorName,
    key: pf.key,
    tempo: pf.tempo,
    score: pf.score,
  }))
  // Keep the converted deadline stable while the server's deadline is unchanged, so countdown
  // effects don't restart on every state message.
  let deadline = null
  if (msg.deadline) {
    deadline =
      prev && prev.rawDeadline === msg.deadline ? prev.deadline : msg.deadline - (msg.serverTime || Date.now()) + Date.now()
  }
  return { ...msg, players, history, deadline, rawDeadline: msg.deadline }
}

export function handle(msg) {
  const patch = { messages: [{ at: Date.now(), msg }, ...state.messages].slice(0, 10) }
  if (msg.room) patch.room = msg.room

  switch (msg.type) {
    case 'welcome':
      patch.token = msg.token // sent again on reconnect so this tab keeps the TV slot
      break
    case 'error':
      patch.error = { message: msg.message, at: Date.now() }
      break
    case 'state': {
      const game = fromServerState(msg, state.game)
      patch.game = game
      if (msg.phase !== state.game?.phase) {
        patch.phaseStartedAt = Date.now()
        patch.calibrated = []
        patch.selected = null
        if (msg.phase === 'perform') Object.assign(patch, { playing: {}, volumes: {}, lastCue: null })
      }
      patch.noteCounts = Object.fromEntries(game.players.map((p) => [p.seat, p.noteCount || 0]))
      break
    }
    case 'select':
      patch.selected = msg.seat
      break
    case 'volume':
      patch.volumes = { ...state.volumes, [msg.seat]: msg.level }
      break
    case 'calibrated': {
      // Sent once, when calibration is done; seats come from the angle map's keys.
      const seats = Object.keys(msg.angles || {}).map(Number)
      patch.calibrated = seats.length
        ? seats
        : (state.game?.players || []).filter((p) => p.seat !== state.game?.conductor).map((p) => p.seat)
      break
    }
  }

  set(patch)
  // State listeners (the audio engine) get the converted game, like the screens do.
  const payload = msg.type === 'state' ? state.game : msg
  listeners[msg.type]?.forEach((fn) => fn(payload))
}

// ---- local updates (connection, audio engine) ----

export const setConnection = (connection) => set({ connection })
export const setMuted = (muted) => set({ muted })
export const setBeat = (beat) => set(beat % 4 === 0 ? { beat, bar: beat / 4 } : { beat })

export function setCue(seat, action, beat) {
  set({ playing: { ...state.playing, [seat]: action === 'in' }, lastCue: { seat, action, beat } })
}
export const setVolume = (seat, level) => set({ volumes: { ...state.volumes, [seat]: level } })
export const bumpHit = (seat) => set({ hits: { ...state.hits, [seat]: (state.hits[seat] || 0) + 1 } })
export const resetPlayback = () => set({ playing: {}, hits: {}, beat: -1, bar: -1 })

export const playerBySeat = (seat) => state.game?.players?.find((p) => p.seat === seat)

if (import.meta.env.DEV) window.store = { getState } // inspect from devtools
