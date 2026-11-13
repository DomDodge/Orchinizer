// Hidden debug overlay, toggled with the backtick key: phase, seats, last 10 messages.
import { useEffect, useState } from 'react'
import { useGameState } from '../state/useGameState.js'
import { timeline } from '../audio/engine.js'
import './debug.css'

const time = (at) => new Date(at).toLocaleTimeString([], { hour12: false }) + '.' + String(at % 1000).padStart(3, '0')

export default function DebugOverlay() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => e.key === '`' && setOpen((o) => !o)
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const s = useGameState()
  if (!open) return null
  const g = s.game || {}

  return (
    <div className="debug">
      <div className="debug-grid">
        <b>phase</b> <span>{g.phase || '-'}</span>
        <b>round</b> <span>{g.round ?? '-'}</span>
        <b>room</b> <span>{s.room || '-'}</span>
        <b>socket</b> <span>{s.connection}</span>
        <b>conductor</b> <span>{g.conductor || '-'}</span>
        <b>selected</b> <span>{s.selected ?? '-'}</span>
        <b>key / bpm</b> <span>{g.key ? `${g.key} / ${g.tempo}` : '-'}</span>
        <b>bar.beat</b> <span>{s.beat >= 0 ? `${s.bar}.${s.beat % 4}` : '-'}</span>
        <b>transport</b> <span>{timeline().running ? 'running' : 'stopped'}</span>
        <b>muted</b> <span>{String(s.muted)}</span>
      </div>

      <table className="debug-seats">
        <thead>
          <tr>
            <th>#</th>
            <th>name</th>
            <th>inst</th>
            <th>notes</th>
            <th>on</th>
            <th>vol</th>
            <th>cal</th>
          </tr>
        </thead>
        <tbody>
          {(g.players || []).map((p) => (
            <tr key={p.seat} className={p.seat === g.conductor ? 'conductor' : ''}>
              <td style={{ color: p.color }}>{p.seat}</td>
              <td>{p.name}</td>
              <td>{p.seat === g.conductor ? 'baton' : p.instrument}</td>
              <td>{p.pattern ? p.pattern.grid.flat().filter(Boolean).length : (s.noteCounts[p.seat] ?? '')}</td>
              <td>{s.playing[p.seat] ? 'yes' : ''}</td>
              <td>{s.volumes[p.seat] ?? ''}</td>
              <td>{s.calibrated.includes(p.seat) ? 'yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="debug-msgs">
        {s.messages.map(({ at, msg }, i) => (
          <div key={i}>
            <span className="debug-time">{time(at)}</span> <b>{msg.type}</b>{' '}
            {JSON.stringify({ ...msg, type: undefined, room: undefined }).slice(0, 140)}
          </div>
        ))}
      </div>
    </div>
  )
}
