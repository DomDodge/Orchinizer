// Countdown ring from the server's `deadline` (ms timestamp). Full when the phase starts
// (phaseStartedAt), empty at the deadline. Not music-tied, so it animates with its own
// requestAnimationFrame loop and writes to the DOM through refs instead of re-rendering.
import { useEffect, useRef } from 'react'
import { useGameState } from '../state/useGameState.js'

const R = 42
const C = 2 * Math.PI * R

export default function CountdownRing({ deadline, size = 96 }) {
  const startedAt = useGameState((s) => s.phaseStartedAt)
  const svg = useRef(null)
  const arc = useRef(null)
  const text = useRef(null)

  useEffect(() => {
    let raf
    const tick = () => {
      const left = Math.max(0, (deadline || 0) - Date.now())
      const total = (deadline || 0) - startedAt
      const frac = total > 0 ? left / total : 0
      arc.current.setAttribute('stroke-dashoffset', C * (1 - frac))
      text.current.textContent = Math.ceil(left / 1000)
      svg.current.classList.toggle('low', left < 5000)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [deadline, startedAt])

  return (
    <svg ref={svg} width={size} height={size} viewBox="0 0 100 100" className="ring">
      <circle cx="50" cy="50" r={R} fill="none" stroke="#23273D" strokeWidth="8" />
      <circle
        ref={arc}
        cx="50"
        cy="50"
        r={R}
        fill="none"
        className="ring-arc"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={C}
        transform="rotate(-90 50 50)"
      />
      <text ref={text} x="50" y="50" dy="0.35em" className="ring-text" />
    </svg>
  )
}
