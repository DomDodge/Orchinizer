// Replays a 10-second clip of each round in order (from the TV's own recordings) while
// phones vote. Each card shows its replay state and the live vote count.
import { useEffect, useState } from 'react'
import { useGameState } from '../state/useGameState.js'
import { getState } from '../state/store.js'
import { replay, stopReplay, bestClip } from '../audio/engine.js'
import MiniStage from '../stage/MiniStage.jsx'
import ReplayBar from '../stage/ReplayBar.jsx'
import CountdownRing from './CountdownRing.jsx'
import './screens.css'

export default function Vote() {
  const game = useGameState((s) => s.game)
  const votes = useGameState((s) => s.votes)
  const performances = useGameState((s) => s.performances)
  const playing = useGameState((s) => s.playing)
  const hits = useGameState((s) => s.hits)

  const rounds = game.history || []
  const players = game.players || []
  const [current, setCurrent] = useState(0) // index being replayed; rounds.length = all done

  useEffect(() => {
    let cancelled = false
    const playFrom = (i) => {
      if (cancelled) return
      setCurrent(i)
      if (i >= rounds.length) return
      const p = getState().performances[rounds[i].round]
      if (!p) return playFrom(i + 1) // no recording (e.g. TV reloaded mid-game)
      replay(p, bestClip(p, 10)).then(() => playFrom(i + 1))
    }
    playFrom(0)
    return () => {
      cancelled = true
      stopReplay()
    }
  }, [])

  const cols = rounds.length <= 4 ? rounds.length : Math.ceil(rounds.length / 2)

  return (
    <div className="screen vote">
      <div className="vote-head">
        <h1>Vote for the best performance</h1>
        <CountdownRing deadline={game.deadline} size={110} />
      </div>

      <div className={`vote-grid ${rounds.length > 4 ? 'two-rows' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {rounds.map((r, i) => {
          const c = players.find((p) => p.seat === r.conductor)
          const recorded = !!performances[r.round]
          const status = !recorded ? 'missing' : i === current ? 'now' : i < current ? 'done' : 'next'
          const count = votes[r.round] || 0
          return (
            <div key={r.round} className={`vote-card ${status === 'now' ? 'active' : ''}`}>
              <div className="vote-card-top">
                <span className="eyebrow">Round {r.round}</span>
                <span className={`badge badge-${status}`}>
                  {{ now: 'Now replaying', done: 'Replayed', next: 'Up next', missing: 'No recording' }[status]}
                </span>
              </div>
              <div className="vote-name" style={{ color: c?.color }}>
                {c?.name}
              </div>
              <div className="vote-meta">
                Key of {r.key} · {r.tempo} BPM
              </div>
              <MiniStage
                players={players}
                conductor={r.conductor}
                playing={status === 'now' ? playing : undefined}
                hits={status === 'now' ? hits : undefined}
              />
              <ReplayBar active={status === 'now'} value={status === 'done' ? 1 : 0} />
              <div className="vote-count">
                <span className="num">{count}</span>
                <span className="vote-label">vote{count === 1 ? '' : 's'}</span>
                <span className="pips">
                  {Array.from({ length: Math.max(count, players.length - 1) }, (_, k) => (
                    <span key={k} className={`pip ${k < count ? 'on' : ''}`} />
                  ))}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <p className="footer-note">Vote on your phone. You can't vote for a performance you conducted.</p>
    </div>
  )
}
