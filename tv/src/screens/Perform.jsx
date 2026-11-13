import { useGameState } from '../state/useGameState.js'
import Stage from '../stage/Stage.jsx'
import NoteLanes from '../stage/NoteLanes.jsx'
import CountdownRing from './CountdownRing.jsx'
import Icon from './Icon.jsx'
import './screens.css'

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

export default function Perform() {
  const game = useGameState((s) => s.game)
  const selected = useGameState((s) => s.selected)
  const playing = useGameState((s) => s.playing)
  const volumes = useGameState((s) => s.volumes)
  const hits = useGameState((s) => s.hits)
  const beat = useGameState((s) => s.beat)
  const bar = useGameState((s) => s.bar)
  const lastCue = useGameState((s) => s.lastCue)

  const players = game.players || []
  const conductor = players.find((p) => p.seat === game.conductor)

  const seats = players.map((p) => {
    const base = { seat: p.seat, color: p.color, name: p.name }
    if (p.seat === game.conductor) return { ...base, mode: 'conductor', subtitle: 'Conductor' }
    const isSelected = selected === p.seat
    return {
      ...base,
      mode: playing[p.seat] ? 'playing' : 'resting',
      subtitle: cap(p.instrument),
      level: volumes[p.seat] ?? 80,
      hits: hits[p.seat] || 0,
      selected: isSelected,
      tag: isSelected ? 'SELECTED' : null,
    }
  })

  const cuePlayer = lastCue && players.find((p) => p.seat === lastCue.seat)

  return (
    <Stage seats={seats} beam={selected} under={
        <>
          {beat >= 0 && <div key={beat} className={`beat-pulse ${beat % 4 === 0 ? 'down' : ''}`} />}
          <NoteLanes />
        </>
      }>
      <div className="perf-top">
        <span className="perf-round num">Round {game.round}</span>
        <span className="perf-who">
          <Icon name="baton" size={34} className="perf-baton" />
          <b style={{ color: conductor?.color }}>{conductor?.name}</b>&nbsp;is conducting
        </span>
        <span className="perf-spacer" />
        <span className="chip perf-chip">Key of {game.key}</span>
        <span className="chip perf-chip">{game.tempo} BPM</span>
        <span className="chip perf-chip perf-bar">
          Bar <b className="num">{Math.max(bar + 1, 0)}</b>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`dot-beat ${beat >= 0 && beat % 4 === i ? 'on' : ''}`} />
          ))}
        </span>
        <CountdownRing deadline={game.deadline} size={88} />
      </div>

      {cuePlayer && (
        // Re-keyed per cue so the fade-in replays.
        <div key={`${lastCue.beat}-${lastCue.seat}`} className="perf-cue">
          <span className="perf-cue-dot" style={{ background: cuePlayer.color }} />
          {cuePlayer.name}'s {cuePlayer.instrument} {lastCue.action === 'in' ? 'came in' : 'dropped out'}
        </div>
      )}
    </Stage>
  )
}
