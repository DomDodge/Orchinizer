// Note lanes above each performing seat, drawn on a canvas. Notes fall at a constant 56px
// per eighth note and touch the seat at the exact moment the TV plays them. A held note
// (from the phone's note editor) is drawn as a bar as tall as it lasts.
//
// This never re-renders through React. A requestAnimationFrame loop reads the Transport
// position (engine.timeline()) and the store (getState()) every frame, so positions come
// straight from the audio clock and can't drift. The landing flash is the seat's own
// flash ring, which the engine fires through Tone.Draw.
//
// Conductor prompts (state.scoring.targets) fall down the same lanes in gold and touch the
// seat at their server time `at`: a flick prompt is a pill (IN/OUT), a hold prompt a bar
// as tall as the hold. Judged ones disappear (Perform shows the grade); misses turn grey.
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
  if (tl.running && game.scoring) drawTargets(ctx, game)
}

function drawTargets(ctx, game) {
  const msPerPx = 60000 / game.tempo / STEPS_PER_BEAT / PX_PER_STEP
  const nowServer = Date.now() - (game.serverOffset || 0)
  ctx.shadowBlur = 0
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '800 18px sans-serif'
  for (const t of game.scoring.targets) {
    if (t.result === 'perfect' || t.result === 'good') continue
    const { x, y: seatY } = seatPos(t.seat)
    const bottom = seatY - SEAT_R - 6
    const y = bottom - (t.at - nowServer) / msPerPx // where the prompt touches the seat
    const top = t.kind === 'hold' ? bottom - (t.end - nowServer) / msPerPx : y
    if (top > bottom || y + 14 < LANE_TOP) continue // landed, or not in the lane yet
    const missed = t.result === 'miss'
    const label = missed ? 'MISS' : t.kind === 'hold' ? 'HOLD' : t.action.toUpperCase()
    ctx.globalAlpha = Math.max(0, Math.min(1, (y - LANE_TOP) / FADE))
    ctx.fillStyle = missed ? 'rgba(244,241,234,0.25)' : '#F2C14E'
    const y0 = Math.max(LANE_TOP, top - 14)
    ctx.beginPath()
    ctx.roundRect(x - LANE_W / 2 + 4, y0, LANE_W - 8, y + 14 - y0, 14)
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
