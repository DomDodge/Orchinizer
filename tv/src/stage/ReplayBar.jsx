// Replay progress bar. When `active`, it follows the engine's replay position every frame
// (through a ref, not React state); otherwise it sits at `value` (0..1).
import { useEffect, useRef } from 'react'
import { replayProgress } from '../audio/engine.js'

export default function ReplayBar({ active, value = 0, color = '#F2C14E' }) {
  const fill = useRef(null)
  useEffect(() => {
    if (!active) return
    let raf
    const frame = () => {
      fill.current.style.width = `${(replayProgress() ?? 0) * 100}%`
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [active])

  return (
    <div className="replay-bar">
      <div ref={fill} className="replay-fill" style={{ width: active ? undefined : `${value * 100}%`, background: color }} />
    </div>
  )
}
