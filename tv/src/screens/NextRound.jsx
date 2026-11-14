import { useGameState } from '../state/useGameState.js'
import { useSecondsLeft } from './useSecondsLeft.js'
import Icon from './Icon.jsx'
import './screens.css'

export default function NextRound() {
  const game = useGameState((s) => s.game)
  const secs = useSecondsLeft(game.deadline)

  const players = game.players || []
  const bySeat = (seat) => players.find((p) => p.seat === seat)
  const next = bySeat(game.conductor)
  const history = game.history || []

  return (
    <div className="screen next">
      <div className="next-center">
        <div className="next-label">
          <Icon name="baton" size={40} className="accent" />
          The baton passes to
        </div>
        <h1 className="next-name" style={{ color: next?.color }}>
          {next?.name}
        </h1>
        <div className="chips center">
          <span className="chip big-chip">Round {game.round}</span>
          <span className="chip big-chip">Key of {game.key}</span>
          <span className="chip big-chip">{game.tempo} BPM</span>
        </div>
        <div key={secs} className="next-count num">
          {secs || ''}
        </div>
      </div>

      {history.length > 0 && (
        <div className="next-strip">
          <span className="eyebrow">So far</span>
          {history.map((h) => {
            const c = bySeat(h.conductor)
            return (
              <span key={h.round} className="chip next-past">
                <b className="num">R{h.round}</b>
                <span className="color-dot" style={{ background: c?.color }} />
                {c?.name}
                <b className="num">{h.score}</b>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
