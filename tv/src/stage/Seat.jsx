// One seat on the stage (SVG). Modes:
//   empty     dashed "Open seat" (lobby)
//   filled    solid color, player joined (lobby)
//   playing   solid, glow grows with level, equalizer bars, volume bar
//   resting   dark fill, faint ring in the seat color
//   conductor dashed gray outline with a baton
//   done      calibrated: solid with a checkmark
//   next      calibrate target: gold glow
//   dim       waiting its turn
// `selected` adds the gold ring; `tag` is a label above the seat; `hits` bumps on every
// note played (via Tone.Draw), which drives the flash ring and equalizer.
import { seatPos, SEAT_R } from './layout.js'
import Icon from '../screens/Icon.jsx'

const SOLID = ['filled', 'playing', 'done']
const STROKE = { empty: '#3A3F5C', conductor: '#A3A8C3', next: '#F2C14E' }

export default function Seat({ seat, mode, color, name, subtitle, level = 80, selected, tag, hits = 0 }) {
  const { x, y } = seatPos(seat)
  const solid = SOLID.includes(mode)
  const dashed = mode === 'empty' || mode === 'conductor'

  const glow =
    mode === 'playing'
      ? `drop-shadow(0 0 ${6 + level * 0.34}px ${color})`
      : mode === 'next'
        ? 'drop-shadow(0 0 30px #F2C14E)'
        : 'none'
  const fill = solid ? color : dashed ? 'none' : '#1B1E30'
  const stroke = STROKE[mode] || (mode === 'resting' || mode === 'dim' ? color : 'none')
  const strokeOpacity = mode === 'resting' ? 0.45 : mode === 'dim' ? 0.25 : 1
  const initialFill = solid ? '#0D0E17' : mode === 'next' ? '#F2C14E' : color

  // Four equalizer bars that jump on every hit.
  const bars = [0, 1, 2, 3].map((i) => 8 + ((hits * 7 + i * 13 + i * i * 3) % 5) * 5)

  return (
    <g transform={`translate(${x} ${y})`} className={`seat seat-${mode}`}>
      {selected && <circle r={SEAT_R + 11} fill="none" stroke="#F2C14E" strokeWidth="5" />}

      {/* flash on each note: re-keyed so the CSS animation restarts */}
      {mode === 'playing' && hits > 0 && (
        <circle key={hits} r={SEAT_R} fill="none" stroke={color} strokeWidth="4" className="seat-ping" />
      )}

      <circle
        r={SEAT_R}
        fill={fill}
        stroke={stroke}
        strokeWidth={mode === 'next' ? 5 : 3}
        strokeDasharray={dashed ? '10 9' : undefined}
        strokeOpacity={strokeOpacity}
        style={{ filter: glow }}
        className="seat-body"
      />

      {mode === 'conductor' ? (
        <Icon name="baton" size={64} x={-32} y={-32} className="seat-baton" />
      ) : mode === 'done' ? (
        <Icon name="check" size={72} x={-36} y={-36} className="seat-check" strokeWidth={3} />
      ) : mode === 'empty' ? (
        <text className="seat-plus" y="16">
          +
        </text>
      ) : (
        <>
          <text className="seat-initial" y={mode === 'playing' ? 8 : 22} fill={initialFill}>
            {name?.[0]?.toUpperCase()}
          </text>
          {mode === 'playing' && (
            <g className="seat-eq">
              {bars.map((h, i) => (
                <rect key={i} x={-25 + i * 13} y={48 - h} width="9" height={h} rx="3" />
              ))}
            </g>
          )}
        </>
      )}

      {tag && (
        <g transform={`translate(0 ${-SEAT_R - (selected ? 46 : 36)})`} className="seat-tag">
          <rect x={-tag.length * 8.5 - 18} y="-19" width={tag.length * 17 + 36} height="38" rx="19" />
          <text y="7">{tag}</text>
        </g>
      )}

      <text className="seat-name" y={SEAT_R + 42}>
        {mode === 'empty' ? 'Open seat' : name}
      </text>
      {subtitle && (
        <text className="seat-sub" y={SEAT_R + 72}>
          {subtitle}
        </text>
      )}
      {mode === 'playing' && (
        <g transform={`translate(-55 ${SEAT_R + 88})`}>
          <rect width="110" height="8" rx="4" fill="#23273D" />
          <rect width={1.1 * level} height="8" rx="4" fill={color} className="seat-vol" />
        </g>
      )}
    </g>
  )
}
