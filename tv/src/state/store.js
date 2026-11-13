import { reactive } from 'vue'

// Single reactive store. `state` is the latest full server snapshot;
// the other fields are live events that arrive between snapshots.
export const store = reactive({
  connection: 'idle', // idle | connecting | open | reconnecting
  room: null,
  state: null,
  selected: null, // seat the conductor is pointing at
  volumes: {}, // seat -> 0..100
  playing: {}, // seat -> true; set by the audio engine when a cue actually lands
  lastCue: null, // { seat, action, beat }
  calibrated: [], // seats calibrated so far
  noteCounts: {}, // seat -> notes placed during compose (counts only, never the notes)
  votes: {}, // round -> count
  beat: -1, // current beat, updated via Tone.Draw
  bar: -1,
  muted: new URLSearchParams(location.search).get('mute') === '1', // ?mute=1 starts silent
  performances: {}, // round -> recorded performance (patterns + cue/volume log) for replays
  messages: [], // last 10 received, newest first (debug overlay)
})

const listeners = {}

// Let other modules (audio) react to specific message types.
export function on(type, fn) {
  ;(listeners[type] ||= new Set()).add(fn)
  return () => listeners[type].delete(fn)
}

export function handle(msg) {
  store.messages.unshift({ at: Date.now(), msg })
  store.messages.length = Math.min(store.messages.length, 10)
  if (msg.room) store.room = msg.room

  switch (msg.type) {
    case 'state': {
      const prev = store.state?.phase
      store.state = msg
      store.selected = null
      if (msg.phase !== prev) {
        store.calibrated = msg.calibrated || []
        if (msg.phase === 'perform') {
          store.playing = {}
          store.volumes = {}
          store.lastCue = null
        }
        if (msg.phase === 'compose') store.noteCounts = {}
      }
      if (msg.votes) store.votes = msg.votes
      break
    }
    case 'select':
      store.selected = msg.seat
      break
    case 'volume':
      store.volumes[msg.seat] = msg.level
      break
    case 'calibrated':
      store.calibrated = msg.seats
      break
    case 'compose_progress':
      store.noteCounts[msg.seat] = msg.notes
      break
    case 'votes':
      store.votes = msg.votes
      break
  }

  listeners[msg.type]?.forEach((fn) => fn(msg))
}

export const playerBySeat = (seat) => store.state?.players?.find((p) => p.seat === seat)
