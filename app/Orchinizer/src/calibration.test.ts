import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureIssue, makeCalibration, conflictingDirection, saveCalibration, getCalibration, clearCalibration } from './calibration.ts';
import { createBaton, type Calib } from './aim.ts';

test('calibration keeps sensor coordinates locally and sends relative angles to the server', () => {
  const raw = [{ seat: 2, angle: 95 }, { seat: 3, angle: 135 }, { seat: 4, angle: 170 }];
  const result = makeCalibration(raw);
  assert.deepEqual(result.local, raw);
  assert.deepEqual(result.angles, { 2: 0, 3: 40, 4: 75 });
  const baton = createBaton(result.local);
  baton.update({ t: 0, heading: 135, elevation: 0, accel: 0.1 });
  assert.equal(baton.selected, 3);
  assert.deepEqual(baton.update({ t: 20, heading: 150, elevation: 0, accel: 12 }).filter(e => e.type === 'flick'), [{ type: 'flick', seat: 3 }]);
});
test('directions wrap correctly across the compass boundary', () => {
  assert.deepEqual(makeCalibration([{ seat: 2, angle: 170 }, { seat: 5, angle: -170 }]).angles, { 2: 0, 5: 20 });
  assert.equal(conflictingDirection([{ seat: 2, angle: 179 }], -177), 2);
});
test('directions too close to distinguish are rejected, but a seat can be redone', () => {
  const saved: Calib = [{ seat: 2, angle: 90 }, { seat: 3, angle: 130 }];
  assert.equal(conflictingDirection(saved, 96), 2);
  assert.equal(conflictingDirection(saved, 105), undefined);
  assert.equal(conflictingDirection(saved, 92, 2), undefined);
  assert.throws(() => makeCalibration([{ seat: 2, angle: NaN }]), /direction/i);
  assert.throws(() => makeCalibration([{ seat: 2, angle: 90 }, { seat: 2, angle: 130 }]), /seat/i);
});
test('saved directions are scoped to this room, round and conductor', () => {
  const scope = { room: 'ABCD', round: 1, conductor: 1 };
  const raw = [{ seat: 2, angle: 95 }];
  saveCalibration(scope, raw);
  raw[0].angle = 0;
  assert.equal(getCalibration(scope)[0].angle, 95);
  assert.deepEqual(getCalibration({ ...scope, room: 'WXYZ' }), []);
  assert.deepEqual(getCalibration({ ...scope, round: 2 }), []);
  assert.deepEqual(getCalibration({ ...scope, conductor: 2 }), []);
  clearCalibration();
  assert.deepEqual(getCalibration(scope), []);
});

test('capture needs a fresh, finite, steady reading', () => {
  const sample = { t: 1000, heading: 95, elevation: 0, accel: 0.2 };
  assert.equal(captureIssue(sample, 1100), null);
  assert.equal(captureIssue(sample, 2100), 'waiting');
  assert.equal(captureIssue({ ...sample, heading: NaN }, 1100), 'waiting');
  assert.equal(captureIssue({ ...sample, accel: 10 }, 1100), 'moving');
  assert.equal(captureIssue(null, 1100), 'waiting');
});
