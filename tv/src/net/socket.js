import { getState, handle, setConnection } from '../state/store.js'
import { MOCK, WS_URL } from '../config.js'
import { createMockServer } from './mock.js'

let transport = null

// Opens the connection (real WebSocket, or the fake server with ?mock=1) and joins as the TV.
export function connect() {
  if (transport) return
  transport = MOCK ? createMockServer(handle) : createSocket(WS_URL)
}

export function send(type, data = {}) {
  const msg = { type, room: getState().room, ...data }
  transport?.send(msg)
}

export const hostAction = (action) => send('host_action', { action })

function createSocket(url) {
  let ws = null
  let retry = 0
  const queue = []

  function open() {
    setConnection(retry ? 'reconnecting' : 'connecting')
    ws = new WebSocket(url)
    ws.onopen = () => {
      retry = 0
      setConnection('open')
      // No room yet: the server creates one. Reconnecting: the token keeps this tab as the TV.
      const { room, token } = getState()
      ws.send(JSON.stringify({ type: 'join', role: 'tv', ...(room && { room }), ...(token && { token }) }))
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
      setConnection('reconnecting')
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
