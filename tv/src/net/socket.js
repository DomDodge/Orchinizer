import { store, handle } from '../state/store.js'
import { MOCK, WS_URL } from '../config.js'
import { createMockServer } from './mock.js'

let transport = null

// Opens the connection (real WebSocket, or the fake server with ?mock=1) and joins as the TV.
export function connect() {
  if (transport) return
  transport = MOCK ? createMockServer(handle) : createSocket(WS_URL)
}

export function send(type, data = {}) {
  const msg = { type, room: store.room, ...data }
  transport?.send(msg)
}

export const hostAction = (action) => send('host_action', { action })

function createSocket(url) {
  let ws = null
  let retry = 0
  const queue = []

  function open() {
    store.connection = retry ? 'reconnecting' : 'connecting'
    ws = new WebSocket(url)
    ws.onopen = () => {
      retry = 0
      store.connection = 'open'
      ws.send(JSON.stringify({ type: 'join', room: store.room, role: 'tv' }))
      while (queue.length) ws.send(queue.shift())
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return console.warn('bad message', e.data)
      }
      handle(msg)
    }
    ws.onclose = () => {
      store.connection = 'reconnecting'
      retry++
      setTimeout(open, Math.min(500 * 2 ** retry, 5000))
    }
  }
  open()

  return {
    send(msg) {
      const s = JSON.stringify(msg)
      if (ws.readyState === WebSocket.OPEN) ws.send(s)
      // Only queue messages that still make sense later; stale bars are useless.
      else if (msg.type !== 'bar') queue.push(s)
    },
  }
}
