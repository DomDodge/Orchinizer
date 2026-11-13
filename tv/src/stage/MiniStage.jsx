// A small, label-free copy of the stage for Vote and Results cards: the same seat arc,
// cropped and scaled by the SVG viewBox. Pass live `playing`/`hits` while this
// performance is replaying; leave them out to show everyone resting.
import { seatPos, SEAT_R } from './layout.js'

export default function MiniStage({ players = [], conductor, playing = {}, hits = {} }) {
  return (
    <svg className="mini-stage" viewBox="170 545 1580 300" preserveAspectRatio="xMidYMid meet">
      <path d="M 120 900 A 840 360 0 0 1 1800 900 Z" fill="#151829" />
      {players.map((p) => {
        const { x, y } = seatPos(p.seat)
        if (p.seat === conductor) {
          return (
            <circle key={p.seat} cx={x} cy={y} r={SEAT_R} fill="none" stroke="#A3A8C3" strokeWidth="8" strokeDasharray="22 18" />
          )
        }
        const on = playing[p.seat]
        return (
          <g key={p.seat}>
            {on && hits[p.seat] > 0 && (
              <circle key={hits[p.seat]} cx={x} cy={y} r={SEAT_R} fill="none" stroke={p.color} strokeWidth="10" className="mini-ping" />
            )}
            <circle
              cx={x}
              cy={y}
              r={SEAT_R}
              fill={on ? p.color : '#1B1E30'}
              stroke={p.color}
              strokeOpacity={on ? 1 : 0.45}
              strokeWidth="8"
              style={{ filter: on ? `drop-shadow(0 0 24px ${p.color})` : 'none', transition: 'fill 0.2s' }}
            />
          </g>
        )
      })}
    </svg>
  )
}
