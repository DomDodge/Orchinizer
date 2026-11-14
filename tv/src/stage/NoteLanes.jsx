// Note lanes above each performing seat, drawn on a canvas. The song's notes fall at a
// constant 56px per eighth note and touch the seat when they're due: that's when the
// conductor should flick at that seat to play it. A held note (a hold prompt: flick, then
// keep pointing) is drawn as a bar as tall as it lasts. Played notes glow; notes nobody
// played in time turn grey.
//
// This never re-renders through React. A requestAnimationFrame loop reads the Transport
// position (engine.timeline()) and the engine's notes every frame, so positions come
// straight from the audio clock and can't drift. The landing flash is the seat's own
// flash ring, which the engine fires through Tone.Draw.
import { useEffect, useRef } from 'react'
import { timeline, seatNotes } from '../audio/engine.js'
import { getState } from '../state/store.js'
import { STEPS_PER_BEAT } from '../audio/part.js'
import { seatPos, SEAT_R, LANE_TOP } from './layout.js'

const PX_PER_EIGHTH = 56
const PX_PER_STEP = PX_PER_EIGHTH / 2 // steps are 16th notes
const R = 10 // note head radius
const LANE_W = 96
const ROW_GAP = 16 // horizontal offset per pitch row
const FADE = 70 // px over which notes fade in at the top

const MISS_AFTER_MS = 300 // /protocol ScoreHitWindowMS: later than this can't be played

function draw(ctx) {
  ctx.clearRect(0, 0, 1920, 1080)
  const { game, selected } = getState()
  if (!game) return
  const tl = timeline()
  const ticksPerStep = tl.ppq / STEPS_PER_BEAT
  const now = tl.tick / ticksPerStep // in 16th-note steps
  const missSteps = MISS_AFTER_MS / (60000 / game.tempo / STEPS_PER_BEAT)

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
    if (!tl.running) continue

    const ahead = (bottom - LANE_TOP) / PX_PER_STEP
    for (const n of seatNotes(p.seat)) {
      if (n.start > now + ahead || n.start + n.length < now) continue
      const y = bottom - (n.start - now) * PX_PER_STEP // where the note starts (touches the seat)
      const alpha = Math.min(1, (y - LANE_TOP) / FADE)
      if (alpha <= 0) continue
      const missed = !n.played && now - n.start > missSteps
      const x = laneX + (n.row - 2) * ROW_GAP
      const tail = Math.max(0, n.length * PX_PER_STEP - 2 * R - 4)
      const top = Math.max(LANE_TOP, y - R - tail)
      ctx.beginPath()
      ctx.roundRect(x - R, top, 2 * R, Math.min(y + R, bottom) - top, R)
      ctx.globalAlpha = alpha * (missed ? 0.35 : 1)
      ctx.fillStyle = missed ? 'rgba(244,241,234,0.5)' : p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = n.played ? 18 : 0
      if (n.played || missed) ctx.fill()
      else {
        // Still to play: a bright outline, so it reads as a prompt.
        ctx.strokeStyle = p.color
        ctx.lineWidth = 3
        ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
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
