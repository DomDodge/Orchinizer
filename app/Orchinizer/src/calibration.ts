import { angleDiff, TUNING, type Calib, type Sample } from './aim.ts';
import type { State } from './protocol';

type Scope = Pick<State, 'room' | 'round' | 'conductor'>;
let saved: { scope: Scope; directions: Calib } | null = null;

/** Sensor samples use absolute headings; only the TV's wire angles are relative to the first seat. */
export function makeCalibration(directions: Calib) {
  const seats = new Set<number>();
  for (const direction of directions) {
    if (!Number.isInteger(direction.seat) || direction.seat < 1 || seats.has(direction.seat)) throw new Error('Invalid calibration seat');
    if (!Number.isFinite(direction.angle)) throw new Error('Invalid calibration direction');
    seats.add(direction.seat);
  }
  const local = directions.map(direction => ({ ...direction }));
  const origin = local[0]?.angle ?? 0;
  const angles = Object.fromEntries(local.map(direction => [direction.seat, Math.round(angleDiff(direction.angle, origin))]));
  return { local, angles };
}

/** A compass cannot distinguish people standing in the same direction. */
export function conflictingDirection(directions: Calib, heading: number, replacingSeat?: number) {
  return directions.find(direction => direction.seat !== replacingSeat && Math.abs(angleDiff(direction.angle, heading)) < 10)?.seat;
}

export function saveCalibration(scope: Scope, directions: Calib) {
  saved = { scope: { ...scope }, directions: makeCalibration(directions).local };
}
export function getCalibration(scope: Scope): Calib {
  if (!saved || saved.scope.room !== scope.room || saved.scope.round !== scope.round || saved.scope.conductor !== scope.conductor) return [];
  return saved.directions.map(direction => ({ ...direction }));
}
export function clearCalibration() { saved = null; }

/** Read the clock when a direction is captured, never while rendering the screen. */
export function captureIssue(sample: Sample | null, now = Date.now()): 'waiting' | 'moving' | null {
  if (!sample || !Number.isFinite(sample.heading) || now - sample.t > 1000) return 'waiting';
  if (sample.accel >= TUNING.freezeMs2) return 'moving';
  return null;
}
