// Note lanes above each performing seat, drawn on a canvas. Notes fall at a constant 56px
// per eighth note and touch the seat at the exact moment the TV plays them. Grid parts are
// dots; note-editor parts are bars as long as each note.
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

const LOOP_STEPS = 32 // a note-editor part loops over 32 16th-note steps (2 bars)

// Fills a lit note (its seat is playing) or outlines a waiting one, in the seat's color.
function mark(ctx, on, alpha, color) {
  if (on) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 16
    ctx.fill()
  } else {
    ctx.globalAlpha = alpha * 0.4
    ctx.shadowBlur = 0
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

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

    const ahead = (bottom - LANE_TOP) / PX_PER_EIGHTH
    if (p.pattern.notes?.length) {
      // Note-editor part: each note is a bar as long as the note; its lower end lands when it plays.
      const px16 = PX_PER_EIGHTH / 2
      const now16 = now * 2
      for (const n of p.pattern.notes) {
        const first = Math.max(0, Math.floor((now16 - n.start - n.length) / LOOP_STEPS) + 1)
        for (let k = first; n.start + k * LOOP_STEPS <= now16 + ahead * 2; k++) {
          const s = n.start + k * LOOP_STEPS
          const low = Math.min(bottom, bottom - (s - now16) * px16)
          const high = Math.max(LANE_TOP, bottom - (s + n.length - now16) * px16)
          if (low - high < 1) continue
          const alpha = Math.min(1, (low - LANE_TOP) / FADE)
          if (alpha <= 0) continue
          ctx.beginPath()
          ctx.roundRect(laneX + (n.row - 2) * ROW_GAP - 9, high, 18, low - high, 9)
          mark(ctx, seatOn(p.seat, (s * ticksPerEighth) / 2), alpha, p.color)
        }
      }
      continue
    }

    const grid = p.pattern.grid
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
        mark(ctx, on, alpha, p.color)
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
