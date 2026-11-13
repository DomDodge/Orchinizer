// Note lanes above each performing seat, drawn on a canvas. Notes fall at a constant 56px
// per eighth note and touch the seat at the exact moment the TV plays them.
//
// This never re-renders through React. A requestAnimationFrame loop reads the Transport
// position (engine.timeline()) and the store (getState()) every frame, so positions come
// straight from the audio clock and can't drift. The landing flash is the seat's own
// flash ring, which the engine fires through Tone.Draw.
import { useEffect, useRef } from 'react'
import { timeline, seatOn } from '../audio/engine.js'
import { getState } from '../state/store.js'
import { seatPos, SEAT_R, LANE_TOP } from './layout.js'

const PX_PER_EIGHTH = 56
const LANE_W = 96
const ROW_GAP = 16 // horizontal offset per pitch row
const FADE = 70 // px over which notes fade in at the top

function draw(ctx) {
  ctx.clearRect(0, 0, 1920, 1080)
  const { game, selected } = getState()
  if (!game) return
  const tl = timeline()
  const ticksPerEighth = tl.ppq / 2
  const now = tl.tick / ticksPerEighth // in eighth notes

  for (const p of game.players) {
    if (p.seat === game.conductor) continue
    const { x: laneX, y: seatY } = seatPos(p.seat)
    const bottom = seatY - SEAT_R - 6

    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.fillStyle = selected === p.seat ? 'rgba(242,193,78,0.13)' : 'rgba(244,241,234,0.035)'
    ctx.beginPath()
    ctx.roundRect(laneX - LANE_W / 2, LANE_TOP, LANE_W, bottom - LANE_TOP, 20)
    ctx.fill()
    if (!tl.running || !p.pattern) continue

    const grid = p.pattern.grid
    const ahead = (bottom - LANE_TOP) / PX_PER_EIGHTH
    for (let e = Math.ceil(now); e <= now + ahead; e++) {
      const step = e % 8
      const y = bottom - (e - now) * PX_PER_EIGHTH
      const alpha = Math.min(1, (y - LANE_TOP) / FADE)
      if (alpha <= 0) continue
      const on = seatOn(p.seat, e * ticksPerEighth)
      for (let row = 0; row < 5; row++) {
        if (!grid[row]?.[step]) continue
        ctx.beginPath()
        ctx.arc(laneX + (row - 2) * ROW_GAP, y, 10, 0, Math.PI * 2)
        if (on) {
          ctx.globalAlpha = alpha
          ctx.fillStyle = p.color
          ctx.shadowColor = p.color
          ctx.shadowBlur = 16
          ctx.fill()
        } else {
          ctx.globalAlpha = alpha * 0.4
          ctx.shadowBlur = 0
          ctx.strokeStyle = p.color
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }
  }
}

export default function NoteLanes() {
  const canvas = useRef(null)
  useEffect(() => {
    const ctx = canvas.current.getContext('2d')
    let raf
    const frame = () => {
      draw(ctx)
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={canvas} width="1920" height="1080" className="stage-layer" />
}
