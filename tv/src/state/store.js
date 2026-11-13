// Plain-JS store, no framework imports. `getState()` returns an immutable snapshot that is
// replaced on every change, so React's useSyncExternalStore (see useGameState.js) can
// compare by reference. Only the update functions below change it.
//
// `game` is the latest full server `state` message; the rest are live events between snapshots.

let state = {
  connection: 'idle', // idle | connecting | open | reconnecting
  room: null,
  game: null,
  selected: null, // seat the conductor is pointing at
  volumes: {}, // seat -> 0..100
  playing: {}, // seat -> true; set by the audio engine when a cue actually lands
  lastCue: null, // { seat, action, beat }
  calibrated: [], // seats calibrated so far
  noteCounts: {}, // seat -> notes placed during compose (counts only, never the notes)
  votes: {}, // round -> count
  hits: {}, // seat -> notes played so far (bumped via Tone.Draw); drives seat flashes
  phaseStartedAt: 0, // when the current phase began, for countdown rings
  beat: -1, // current beat, updated via Tone.Draw
  bar: -1,
  muted: new URLSearchParams(location.search).get('mute') === '1', // ?mute=1 starts silent
  // round -> recorded performance (patterns + cue/volume log) for replays. The engine appends
  // to a performance's log in place; that never needs a re-render.
  performances: {},
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

export function handle(msg) {
  const patch = { messages: [{ at: Date.now(), msg }, ...state.messages].slice(0, 10) }
  if (msg.room) patch.room = msg.room

  switch (msg.type) {
    case 'state': {
      patch.game = msg
      patch.selected = null
      if (msg.phase !== state.game?.phase) {
        patch.phaseStartedAt = Date.now()
        patch.calibrated = msg.calibrated || []
        if (msg.phase === 'perform') Object.assign(patch, { playing: {}, volumes: {}, lastCue: null })
        if (msg.phase === 'compose') patch.noteCounts = {}
      }
      if (msg.votes) patch.votes = msg.votes
      break
    }
    case 'select':
      patch.selected = msg.seat
      break
    case 'volume':
      patch.volumes = { ...state.volumes, [msg.seat]: msg.level }
      break
    case 'calibrated':
      patch.calibrated = msg.seats
      break
    case 'compose_progress':
      patch.noteCounts = { ...state.noteCounts, [msg.seat]: msg.notes }
      break
    case 'votes':
      patch.votes = msg.votes
      break
  }

  set(patch)
  listeners[msg.type]?.forEach((fn) => fn(msg))
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
export const savePerformance = (p) => set({ performances: { ...state.performances, [p.round]: p } })

export const playerBySeat = (seat) => state.game?.players?.find((p) => p.seat === seat)

if (import.meta.env.DEV) window.store = { getState } // inspect from devtools
