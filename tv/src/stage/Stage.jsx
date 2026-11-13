// Shared stage for Lobby, Calibrate and Perform. Fills the 1920x1080 frame.
//   seats: array of Seat props (one per seat to show; leave a seat out to hide it)
//   beam:  seat number to aim the gold podium beam at, or null
//   under: rendered between the floor and the seats (e.g. <NoteLanes />)
//   children: rendered on top (screen headers / footers)
import Seat from './Seat.jsx'
import Beam from './Beam.jsx'
import Icon from '../screens/Icon.jsx'
import { PODIUM } from './layout.js'
import './stage.css'

export default function Stage({ seats, beam, under, children }) {
  return (
    <div className="stage">
      <svg className="stage-layer" viewBox="0 0 1920 1080">
        <path d="M 40 1080 A 920 560 0 0 1 1880 1080 Z" fill="#151829" />
        <path d="M 260 1080 A 700 400 0 0 1 1660 1080" fill="none" stroke="#1B1E30" strokeWidth="2" />
      </svg>

      {under}

      <svg className="stage-layer" viewBox="0 0 1920 1080">
        <Beam seat={beam} />
        {seats.map((s) => (
          <Seat key={s.seat} {...s} />
        ))}
        <g transform={`translate(${PODIUM.x} ${PODIUM.y})`} className="podium">
          <rect x="-100" y="-32" width="200" height="64" rx="16" />
          <Icon name="baton" size={26} x={-66} y={-13} className="podium-baton" />
          <text x="14" y="9">
            Podium
          </text>
        </g>
      </svg>

      {children}
    </div>
  )
}
