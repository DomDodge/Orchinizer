// Pure conductor gesture logic: motion samples in, baton events out. No React, no sensors, so it's testable.

/** Tuning knobs. Expect to change these after testing with real people waving phones. */
export const TUNING = {
  hysteresisDeg: 5,
  endSeatMaxDeg: 20, // how far past the outermost seat still selects it
  freezeMs2: 4, // above this, the phone is swinging: freeze selection and volume
  flickMs2: 8, // real flicks peaked 9.5–85; holding/moving stayed under 5 (iPhone, 2026-11-13 test)
  rearmMs2: 3, // a flick only counts again after the phone settles below this, so the stop isn't a 2nd flick
  cooldownMs: 300,
  volumeMinDeg: -30, // top edge 30° down = 0%
  volumeMaxDeg: 60, // top edge 60° up = 100%
  volumeEveryMs: 100,
};

export type Calib = { seat: number; angle: number }[];
export type Sample = { t: number; heading: number; elevation: number; accel: number };
export type BatonEvent =
  | { type: 'select'; seat: number }
  | { type: 'flick'; seat: number }
  | { type: 'volume'; level: number };

/** Signed smallest difference a - b in degrees, in [-180, 180). */
export const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** How far from seat i the selection reaches toward `heading`: half the gap to the neighbor on that side, or
 *  endSeatMaxDeg past the outermost seat. */
function reach(i: number, heading: number, calib: Calib) {
  const side = Math.sign(angleDiff(heading, calib[i].angle));
  let gap = Infinity;
  calib.forEach((c, j) => {
    const d = angleDiff(c.angle, calib[i].angle);
    if (j !== i && Math.sign(d) === side) gap = Math.min(gap, Math.abs(d));
  });
  return gap === Infinity ? TUNING.endSeatMaxDeg : gap / 2;
}

/** Nearest calibrated seat in reach; the current seat stays selected until `hysteresisDeg` past the boundary. 0 = none. */
export function selectSeat(heading: number, calib: Calib, current: number): number {
  const dist = (i: number) => Math.abs(angleDiff(heading, calib[i].angle));
  let best = -1;
  calib.forEach((_, i) => (best < 0 || dist(i) < dist(best)) && (best = i));
  const cur = calib.findIndex((c) => c.seat === current);
  const h = TUNING.hysteresisDeg;
  if (cur >= 0 && dist(cur) <= dist(best) + 2 * h && dist(cur) <= reach(cur, heading, calib) + h) return current;
  return best >= 0 && dist(best) <= reach(best, heading, calib) ? calib[best].seat : 0;
}

/** One flick per gesture: fires when accel crosses flickMs2, then waits for the phone to settle. */
export function createFlickDetector() {
  let lastFlick = -Infinity;
  let armed = true;
  return (s: Pick<Sample, 't' | 'accel'>) => {
    if (s.accel < TUNING.rearmMs2) armed = true;
    if (!armed || s.accel <= TUNING.flickMs2 || s.t - lastFlick <= TUNING.cooldownMs) return false;
    armed = false;
    lastFlick = s.t;
    return true;
  };
}

export function createBaton(calib: Calib) {
  let selected = 0;
  const isFlick = createFlickDetector();
  let lastVolumeAt = -Infinity;
  let lastLevel = -1;

  return {
    get selected() {
      return selected;
    },
    update(s: Sample): BatonEvent[] {
      const ev: BatonEvent[] = [];
      const steady = s.accel < TUNING.freezeMs2;

      // The flick swings the phone, so only re-aim while steady: a cue uses the pre-swing seat.
      if (steady) {
        const seat = selectSeat(s.heading, calib, selected);
        if (seat !== selected) ev.push({ type: 'select', seat: (selected = seat) });
      }

      if (isFlick(s) && selected) ev.push({ type: 'flick', seat: selected });

      if (steady && s.t - lastVolumeAt >= TUNING.volumeEveryMs) {
        const { volumeMinDeg: lo, volumeMaxDeg: hi } = TUNING;
        const level = Math.round(Math.min(1, Math.max(0, (s.elevation - lo) / (hi - lo))) * 100);
        if (Math.abs(level - lastLevel) >= 3) {
          lastVolumeAt = s.t;
          lastLevel = level;
          ev.push({ type: 'volume', level });
        }
      }
      return ev;
    },
  };
}
