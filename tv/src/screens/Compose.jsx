import { useGameState } from '../state/useGameState.js'
import CountdownRing from './CountdownRing.jsx'
import Icon from './Icon.jsx'
import './screens.css'

const SEGMENTS = 16
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

export default function Compose() {
  const game = useGameState((s) => s.game)
  const noteCounts = useGameState((s) => s.noteCounts)

  const players = game.players || []
  const conductor = players.find((p) => p.seat === game.conductor)
  const composers = players.filter((p) => p.seat !== game.conductor)

  return (
    <div className="screen compose">
      <div className="compose-head">
        <div>
          <div className="eyebrow">Round {game.round}</div>
          <h1>Compose your part</h1>
          <div className="chips">
            <span className="chip big-chip">Key of {game.key}</span>
            <span className="chip big-chip">{game.tempo} BPM</span>
            <span className="chip big-chip">
              <Icon name="baton" className="accent" />
              Next conductor:&nbsp;<b style={{ color: conductor?.color }}>{conductor?.name}</b>
            </span>
          </div>
        </div>
        <CountdownRing deadline={game.deadline} size={150} />
      </div>

      <div className="compose-grid">
        {composers.map((p) => {
          // Only counts arrive from the server; the notes themselves stay secret.
          const notes = noteCounts[p.seat] || 0
          return (
            <div key={p.seat} className="compose-card">
              <div className="compose-row">
                <span className="color-dot" style={{ background: p.color }} />
                <span className="compose-name">{p.name}</span>
                <span className="chip">{cap(p.instrument)}</span>
              </div>
              <div className="compose-notes">
                <span className="num">{notes}</span> note{notes === 1 ? '' : 's'}
              </div>
              <div className="meter">
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <span key={i} className="meter-seg" style={i < notes ? { background: p.color } : undefined} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="footer-note">Tap notes on your phone's grid. Your part stays secret until the performance.</p>
    </div>
  )
}
