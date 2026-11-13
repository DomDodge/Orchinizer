import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useGameState } from '../state/useGameState.js'
import { hostAction } from '../net/socket.js'
import { setMuted } from '../audio/engine.js'
import { JOIN_URL } from '../config.js'
import Stage from '../stage/Stage.jsx'
import Icon from './Icon.jsx'
import './screens.css'

const MIN_PLAYERS = 4
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

function statusLine(count) {
  if (count < MIN_PLAYERS) {
    const need = MIN_PLAYERS - count
    return `Waiting for ${need} more player${need === 1 ? '' : 's'}`
  }
  return count < 8 ? 'Ready when you are. More can still join.' : 'Full house.'
}

export default function Lobby() {
  const players = useGameState((s) => s.game?.players) || []
  const room = useGameState((s) => s.room)
  const muted = useGameState((s) => s.muted)

  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toString(JOIN_URL, { type: 'svg', margin: 1, color: { dark: '#0D0E17', light: '#F4F1EA' } }).then(setQr)
  }, [])

  const seats = Array.from({ length: 8 }, (_, i) => {
    const p = players.find((pl) => pl.seat === i + 1)
    return p
      ? { seat: i + 1, mode: 'filled', color: p.color, name: p.name, subtitle: cap(p.instrument) }
      : { seat: i + 1, mode: 'empty' }
  })
  const count = players.length

  return (
    <Stage seats={seats}>
      <div className="lobby-title">
        <h1>Phone Orchestra</h1>
        <p>Grab your phone. You're the orchestra.</p>
      </div>

      <div className="lobby-steps">
        <div className="lobby-card">
          <div className="lobby-step">
            <span className="lobby-n">1</span>Get the app
          </div>
          <div className="lobby-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="lobby-hint">Scan with your phone camera</div>
        </div>
        <div className="lobby-card">
          <div className="lobby-step">
            <span className="lobby-n">2</span>Enter room code
          </div>
          <div className="lobby-tiles">
            {(room || '····').split('').map((c, i) => (
              <span key={i} className="lobby-tile">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="lobby-footer">
        <div className="lobby-count">
          <span className="num">{count} / 8</span>
          <span className="lobby-status">{statusLine(count)}</span>
        </div>
        <div className="lobby-actions">
          <button className="chip lobby-sound" onClick={() => setMuted(!muted)}>
            <Icon name={muted ? 'speaker-off' : 'speaker'} />
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button className="btn" disabled={count < MIN_PLAYERS} onClick={() => hostAction('start')}>
            Start game
          </button>
        </div>
      </div>
    </Stage>
  )
}
