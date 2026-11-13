import { useEffect } from 'react'
import { useGameState } from '../state/useGameState.js'
import { getState } from '../state/store.js'
import { hostAction } from '../net/socket.js'
import { replay, stopReplay } from '../audio/engine.js'
import MiniStage from '../stage/MiniStage.jsx'
import ReplayBar from '../stage/ReplayBar.jsx'
import Icon from './Icon.jsx'
import './screens.css'

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']

export default function Results() {
  const game = useGameState((s) => s.game)
  const votes = useGameState((s) => s.votes)
  const performances = useGameState((s) => s.performances)
  const playing = useGameState((s) => s.playing)
  const hits = useGameState((s) => s.hits)

  const players = game.players || []
  const bySeat = (seat) => players.find((p) => p.seat === seat)
  // Most votes first; the server's `winner` (a round number) wins any tie.
  const ranked = [...(game.history || [])].sort(
    (a, b) => (votes[b.round] || 0) - (votes[a.round] || 0) || (b.round === game.winner) - (a.round === game.winner),
  )
  const win = ranked[0]
  const winner = win && bySeat(win.conductor)
  const winVotes = win ? votes[win.round] || 0 : 0
  const recorded = win && performances[win.round]

  // Loop the full winning performance for as long as this screen is up.
  useEffect(() => {
    if (!win) return
    let cancelled = false
    const loop = () => {
      const p = getState().performances[win.round]
      if (cancelled || !p) return
      replay(p).then((completed) => completed && loop())
    }
    loop()
    return () => {
      cancelled = true
      stopReplay()
    }
  }, [win?.round])

  if (!win) return <div className="screen results" />

  return (
    <div className="screen results">
      <div className="results-left">
        <Icon name="crown" size={96} className="accent" strokeWidth={1.6} />
        <div className="results-label">WINNER</div>
        <h1 className="results-name" style={{ color: winner?.color }}>
          {winner?.name}
        </h1>
        <p className="results-sub">conducted the best performance</p>
        <div className="results-votes">
          <span className="num">{winVotes}</span> vote{winVotes === 1 ? '' : 's'}
        </div>

        <div className="results-runners">
          {ranked.slice(1).map((r, i) => {
            const c = bySeat(r.conductor)
            const n = votes[r.round] || 0
            return (
              <div key={r.round} className="runner">
                <span className="runner-place num">{ORDINAL[i + 1]}</span>
                <span className="color-dot" style={{ background: c?.color }} />
                <span className="runner-name">{c?.name}</span>
                <span className="runner-round">Round {r.round}</span>
                <span className="runner-votes">
                  {n} vote{n === 1 ? '' : 's'}
                </span>
              </div>
            )
          })}
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
        <div className="vote-card-top">
          <span className="eyebrow">
            Round {win.round} · Key of {win.key} · {win.tempo} BPM
          </span>
          <span className={`badge badge-${recorded ? 'now' : 'missing'}`}>{recorded ? 'Now replaying' : 'No recording'}</span>
        </div>
        <MiniStage players={players} conductor={win.conductor} playing={playing} hits={hits} />
        <ReplayBar active={!!recorded} />
        <p className="results-card-note">The winning performance, exactly as it was played.</p>
      </div>
    </div>
  )
}
