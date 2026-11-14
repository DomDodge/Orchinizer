// Note lanes above each performing seat, drawn on a canvas. Notes fall at a constant 56px
// per eighth note and touch the seat at the exact moment the TV plays them. A held note
// (from the phone's note editor) is drawn as a bar as tall as it lasts.
//
// This never re-renders through React. A requestAnimationFrame loop reads the Transport
// position (engine.timeline()) and the store (getState()) every frame, so positions come
// straight from the audio clock and can't drift. The landing flash is the seat's own
// flash ring, which the engine fires through Tone.Draw.
//
// Cue prompts (state.targets) fall down the same lanes as gold bars and touch the seat on
// their beat: that's when the conductor should cue the seat. Hit ones disappear (Perform
// shows the grade); one that's too late to score turns grey.
import { useEffect, useRef } from 'react'
import { timeline, seatOn } from '../audio/engine.js'
import { getState } from '../state/store.js'
import { partNotes, STEPS_PER_BEAT } from '../audio/part.js'
import { seatPos, SEAT_R, LANE_TOP } from './layout.js'

const PX_PER_EIGHTH = 56
const PX_PER_STEP = PX_PER_EIGHTH / 2 // steps are 16th notes
const R = 10 // note head radius
const LANE_W = 96
const ROW_GAP = 16 // horizontal offset per pitch row
const FADE = 70 // px over which notes fade in at the top
const MISS_AFTER_MS = 450 // GOOD_WINDOW_MS + CUE_LATENCY_MS in /protocol: later can't score

function draw(ctx) {
  ctx.clearRect(0, 0, 1920, 1080)
  const { game, selected } = getState()
  if (!game) return
  const tl = timeline()
  const ticksPerStep = tl.ppq / STEPS_PER_BEAT
  const now = tl.tick / ticksPerStep // in 16th-note steps

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

    const { loopSteps, notes } = partNotes(p.pattern)
    const ahead = (bottom - LANE_TOP) / PX_PER_STEP
    for (let e = Math.ceil(now); e <= now + ahead; e++) {
      const step = e % loopSteps
      const y = bottom - (e - now) * PX_PER_STEP // where the note starts (touches the seat)
      const alpha = Math.min(1, (y - LANE_TOP) / FADE)
      if (alpha <= 0) continue
      const on = seatOn(p.seat, e * ticksPerStep)
      for (const n of notes) {
        if (n.start !== step) continue
        const x = laneX + (n.row - 2) * ROW_GAP
        // Grid notes are dots; held notes stretch upward for as long as they sound.
        const tail = n.fromGrid ? 0 : Math.max(0, n.length * PX_PER_STEP - 2 * R - 4)
        ctx.beginPath()
        ctx.roundRect(x - R, Math.max(LANE_TOP, y - R - tail), 2 * R, 2 * R + Math.min(tail, y - R - LANE_TOP), R)
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
  if (tl.running) drawTargets(ctx, game, now, ticksPerStep)
}

function drawTargets(ctx, game, now, ticksPerStep) {
  const stepMs = 60000 / game.tempo / STEPS_PER_BEAT
  ctx.shadowBlur = 0
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '800 18px sans-serif'
  for (const t of game.targets || []) {
    if (t.grade === 'perfect' || t.grade === 'good') continue
    const { x, y: seatY } = seatPos(t.seat)
    const bottom = seatY - SEAT_R - 6
    const at = t.beat * STEPS_PER_BEAT
    const y = bottom - (at - now) * PX_PER_STEP
    if (y < LANE_TOP || y > bottom + 30) continue
    const missed = t.grade === 'miss' || (now - at) * stepMs > MISS_AFTER_MS
    const label = missed ? 'MISS' : seatOn(t.seat, at * ticksPerStep - 1) ? 'OUT' : 'IN'
    ctx.globalAlpha = Math.min(1, (y - LANE_TOP) / FADE)
    ctx.fillStyle = missed ? 'rgba(244,241,234,0.25)' : '#F2C14E'
    ctx.beginPath()
    ctx.roundRect(x - LANE_W / 2 + 4, y - 14, LANE_W - 8, 28, 14)
    ctx.fill()
    ctx.fillStyle = '#0E1020'
    ctx.fillText(label, x, y + 1)
  }
  ctx.globalAlpha = 1
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
