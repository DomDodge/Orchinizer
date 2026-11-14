import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, createBaton, createFlickDetector, selectSeat, type Calib } from './aim.ts';

// Semicircle: seats 2, 3, 4 at -40°, 0°, +40°.
const calib: Calib = [
  { seat: 2, angle: -40 },
  { seat: 3, angle: 0 },
  { seat: 4, angle: 40 },
];

test('angleDiff wraps', () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(350, 10), -20);
});

test('selectSeat picks the nearest seat', () => {
  assert.equal(selectSeat(-35, calib, 0), 2);
  assert.equal(selectSeat(5, calib, 0), 3);
  assert.equal(selectSeat(45, calib, 0), 4);
});

test('selectSeat holds the current seat inside the hysteresis band', () => {
  assert.equal(selectSeat(23, calib, 3), 3); // 23° is closer to 4 but within 5° of the midpoint
  assert.equal(selectSeat(26, calib, 3), 4);
});

test('selectSeat selects nothing past the end of the semicircle', () => {
  assert.equal(selectSeat(55, calib, 0), 4);
  assert.equal(selectSeat(70, calib, 0), 0);
  assert.equal(selectSeat(0, [], 0), 0);
});

const still = { elevation: 10, accel: 0.2 };

test('flick cues the seat selected before the swing, then cools down', () => {
  const b = createBaton(calib);
  assert.deepEqual(b.update({ t: 0, heading: 0, ...still }).filter((e) => e.type === 'select'), [{ type: 'select', seat: 3 }]);
  // Swing: heading jumps toward seat 4 while accelerating; selection stays frozen.
  b.update({ t: 50, heading: 30, elevation: 10, accel: 6 });
  const cue = b.update({ t: 60, heading: 38, elevation: 10, accel: 20 });
  assert.deepEqual(cue.filter((e) => e.type === 'flick'), [{ type: 'flick', seat: 3 }]);
  assert.equal(b.update({ t: 200, heading: 0, elevation: 10, accel: 20 }).filter((e) => e.type === 'flick').length, 0);
  b.update({ t: 380, heading: 0, ...still });
  assert.equal(b.update({ t: 400, heading: 0, elevation: 10, accel: 20 }).filter((e) => e.type === 'flick').length, 1);
});

test('volume follows tilt, throttled to 10/s', () => {
  const b = createBaton(calib);
  const vol = (t: number, elevation: number) => b.update({ t, heading: 0, elevation, accel: 0.2 }).find((e) => e.type === 'volume');
  assert.deepEqual(vol(0, 15), { type: 'volume', level: 50 });
  assert.equal(vol(50, 60), undefined); // throttled
  assert.deepEqual(vol(100, 60), { type: 'volume', level: 100 });
  assert.deepEqual(vol(200, -45), { type: 'volume', level: 0 });
});

test('a flick counts once per gesture, not again on the stop', () => {
  const isFlick = createFlickDetector();
  // Shaped like a real 11 m/s² flick from the test log: jab, dip, stop spike, settle, next flick.
  const trace = [[0, 1], [40, 11], [80, 5], [400, 9.5], [450, 2], [900, 10.5]];
  assert.deepEqual(trace.filter(([t, accel]) => isFlick({ t, accel })).map(([t]) => t), [40, 900]);
  // Soft movement never counts.
  assert.equal([[1000, 1], [1100, 5], [1200, 4]].filter(([t, accel]) => isFlick({ t, accel })).length, 0);
});
