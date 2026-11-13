// Stage geometry, in 1920x1080 stage pixels. Seats are numbered 1-8.
export const SEAT_R = 70
export const PODIUM = { x: 960, y: 930 }
export const LANE_TOP = 175

export function seatPos(seat) {
  const i = seat - 1
  const t = Math.abs(i - 3.5) / 3.5
  return { x: 960 + (i - 3.5) * 200, y: 640 + t * t * 140 }
}
