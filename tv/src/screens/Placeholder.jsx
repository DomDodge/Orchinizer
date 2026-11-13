// Temporary stand-in for screens not built yet. Shows the raw state and host controls.
import { useGameState } from '../state/useGameState.js'
import { hostAction } from '../net/socket.js'
import { setMuted } from '../audio/engine.js'
import ConnectionChip from './ConnectionChip.jsx'
import './screens.css'

const json = (v) => JSON.stringify(v, null, 1)

export default function Placeholder() {
  const s = useGameState()
  const players = s.game?.players || []
  return (
    <div className="ph">
      <header>
        <h1>{s.game?.phase || 'waiting for server'}</h1>
        <span className="chip">Room {s.room || '----'}</span>
        <ConnectionChip />
      </header>
      <div className="ph-controls">
        {['start', 'next', 'skip'].map((a) => (
          <button key={a} className="btn" onClick={() => hostAction(a)}>
            {a}
          </button>
        ))}
        <button className="btn" onClick={() => setMuted(!s.muted)}>
          {s.muted ? 'unmute' : 'mute'}
        </button>
      </div>
      <div className="ph-audio">
        <span className="chip">bar {s.bar}</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`dot-beat ${s.beat >= 0 && s.beat % 4 === i ? 'on' : ''}`} />
        ))}
        {players.map((p) => (
          <span
            key={p.seat}
            className="ph-seat"
            style={s.playing[p.seat] ? { background: p.color, color: '#0D0E17' } : { borderColor: p.color }}
          >
            {p.seat} {p.instrument} {s.volumes[p.seat] ?? ''}
          </span>
        ))}
        {s.lastCue && (
          <span className="chip">
            last cue: seat {s.lastCue.seat} {s.lastCue.action} on beat {s.lastCue.beat}
          </span>
        )}
      </div>
      <div className="ph-cols">
        <pre>{json({ ...s.game, players: undefined })}</pre>
        <pre>
          {json({ selected: s.selected, volumes: s.volumes, calibrated: s.calibrated, noteCounts: s.noteCounts, votes: s.votes })}
        </pre>
        <pre>{s.messages.map((m) => JSON.stringify(m.msg).slice(0, 90)).join('\n')}</pre>
      </div>
      <ul>
        {players.map((p) => (
          <li key={p.seat} style={{ color: p.color }}>
            {p.seat}. {p.name}: {p.instrument}
            {p.pattern ? ' (pattern locked)' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
