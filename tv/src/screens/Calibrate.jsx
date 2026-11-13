import { useGameState } from '../state/useGameState.js'
import Stage from '../stage/Stage.jsx'
import './screens.css'

export default function Calibrate() {
  const game = useGameState((s) => s.game)
  const calibrated = useGameState((s) => s.calibrated)

  const players = game.players || []
  const conductor = players.find((p) => p.seat === game.conductor)
  const performers = players.filter((p) => p.seat !== game.conductor).sort((a, b) => a.seat - b.seat)
  // Assumes seats are calibrated in seat order.
  const next = performers.find((p) => !calibrated.includes(p.seat))?.seat ?? null

  const seats = players.map((p) => {
    const base = { seat: p.seat, color: p.color, name: p.name }
    if (p.seat === game.conductor) return { ...base, mode: 'conductor', subtitle: 'Conductor' }
    if (calibrated.includes(p.seat)) return { ...base, mode: 'done', subtitle: 'Set' }
    if (p.seat === next) return { ...base, mode: 'next', tag: 'POINT HERE' }
    return { ...base, mode: 'dim' }
  })

  return (
    <Stage seats={seats} beam={next}>
      <div className="cal-head">
        <h1>
          Now conducting: <span style={{ color: conductor?.color }}>{conductor?.name}</span>
        </h1>
        <p>{next ? 'Point your phone at the glowing seat and hold it there.' : 'All set. Get ready to conduct.'}</p>
      </div>
      <div className="cal-counter">
        <span className="num">
          {calibrated.length} / {performers.length}
        </span>
        <span>seats set</span>
      </div>
    </Stage>
  )
}
