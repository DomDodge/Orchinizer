import { useGameState } from '../state/useGameState.js'
import { hostAction } from '../net/socket.js'
import Icon from './Icon.jsx'
import './screens.css'

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']
const points = (pf) => pf.score?.points ?? 0

export default function Results() {
  const game = useGameState((s) => s.game)

  const players = game.players || []
  const bySeat = (seat) => players.find((p) => p.seat === seat)
  // Most points first; the server's `winner` (a round number) wins any tie.
  const ranked = [...(game.performances || [])].sort(
    (a, b) => points(b) - points(a) || (b.round === game.winner) - (a.round === game.winner) || a.round - b.round,
  )
  const win = ranked[0]
  if (!win) return <div className="screen results" />

  return (
    <div className="screen results">
      <div className="results-left">
        <Icon name="crown" size={96} className="accent" strokeWidth={1.6} />
        <div className="results-label">WINNER</div>
        <h1 className="results-name rise" style={{ color: bySeat(win.conductorSeat)?.color }}>
          {win.conductorName}
        </h1>
        <p className="results-sub">kept the band best in time</p>
        <div className="results-points">
          <span className="num">{points(win)}</span> points
        </div>

        <div className="results-actions">
          <button className="btn" onClick={() => (hostAction('restart'), hostAction('start'))}>
            Play again
          </button>
          <button className="btn btn-ghost" onClick={() => hostAction('restart')}>
            Back to lobby
          </button>
        </div>
      </div>

      <div className="results-card">
        <span className="eyebrow">Leaderboard</span>
        {ranked.map((r, i) => (
          <div key={r.round} className={`runner ${i === 0 ? 'first' : ''}`}>
            <span className="runner-place num">{ORDINAL[i]}</span>
            <span className="color-dot" style={{ background: bySeat(r.conductorSeat)?.color }} />
            <span className="runner-name">{r.conductorName}</span>
            {r.score && (
              <span className="runner-grades">
                {r.score.perfect} perfect · {r.score.good} good · {r.score.misses} miss · combo {r.score.maxCombo}
              </span>
            )}
            <span className="runner-score num">{points(r)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
