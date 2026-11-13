// Gold beam from the podium to a seat: a wedge (narrow at the podium) plus a center line.
import { seatPos, PODIUM } from './layout.js'

export default function Beam({ seat }) {
  if (!seat) return null
  const a = { x: PODIUM.x, y: PODIUM.y - 34 }
  const b = seatPos(seat)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const w0 = 6
  const w1 = 52
  const wedge = `M ${a.x + nx * w0} ${a.y + ny * w0} L ${b.x + nx * w1} ${b.y + ny * w1} L ${b.x - nx * w1} ${b.y - ny * w1} L ${a.x - nx * w0} ${a.y - ny * w0} Z`

  return (
    <g className="beam">
      <defs>
        <linearGradient id="beam-grad" gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
          <stop offset="0" stopColor="#F2C14E" stopOpacity="0.55" />
          <stop offset="1" stopColor="#F2C14E" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <path d={wedge} fill="url(#beam-grad)" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#F2C14E" strokeWidth="3" strokeOpacity="0.8" />
    </g>
  )
}
