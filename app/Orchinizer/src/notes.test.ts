import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_STEPS, MAX_NOTES, ROWS, type Note } from '../../../protocol/messages.ts';
import { fits, move, place, remove, resize } from './notes.ts';

const n = (id: string, row: number, start: number, length: number): Note => ({ id, row, start, length });

test('place adds a 1-beat note', () => {
  assert.deepEqual(place([], 2, 0, 'a'), [n('a', 2, 0, 4)]);
});

test('place shortens to fit before the next note and the loop end', () => {
  assert.deepEqual(place([n('b', 1, 2, 4)], 1, 0, 'a')?.at(-1), n('a', 1, 0, 2));
  assert.deepEqual(place([], 0, LOOP_STEPS - 1, 'a'), [n('a', 0, LOOP_STEPS - 1, 1)]);
});

test('place refuses an occupied cell, a full budget, a bad row and a reused id', () => {
  assert.equal(place([n('b', 1, 0, 4)], 1, 2, 'a'), null);
  const full = Array.from({ length: MAX_NOTES }, (_, i) => n(`n${i}`, i % ROWS, Math.floor(i / ROWS) * 4, 1));
  assert.equal(place(full, 0, LOOP_STEPS - 1, 'x'), null);
  assert.equal(place([], ROWS, 0, 'a'), null);
  assert.equal(place([], -1, 0, 'a'), null);
  assert.equal(place([n('a', 0, 0, 1)], 3, 8, 'a'), null);
});

test('chords on different rows are allowed', () => {
  assert.equal(place([n('a', 0, 0, 8)], 1, 0, 'b')?.length, 2);
});

test('resize stretches and shrinks, but not past the loop or into a neighbor', () => {
  const notes = [n('a', 0, 0, 4), n('b', 0, 8, 4)];
  assert.equal(resize(notes, 'a', 8)[0].length, 8); // ends exactly where b starts
  assert.equal(resize(notes, 'a', 1)[0].length, 1);
  assert.equal(resize(notes, 'a', 9), notes); // would overlap b: snaps back
  assert.equal(resize(notes, 'b', LOOP_STEPS - 7), notes); // past the loop
  assert.equal(resize(notes, 'a', 0), notes);
});

test('move changes time and pitch, but not onto another note or off the staff', () => {
  const notes = [n('a', 0, 0, 4), n('b', 1, 0, 4)];
  assert.deepEqual(move(notes, 'a', 2, 12)[0], n('a', 2, 12, 4));
  assert.equal(move(notes, 'a', 1, 2), notes); // onto b
  assert.equal(move(notes, 'a', ROWS, 0), notes);
  assert.equal(move(notes, 'a', 0, LOOP_STEPS - 3), notes); // would run past the loop
  assert.deepEqual(move(notes, 'a', 0, 0), notes); // a note doesn't collide with itself
});

test('fractional positions from drag math are rejected (the server only takes whole steps)', () => {
  assert.equal(fits([], n('a', 0, 1.5, 2)), false);
  assert.equal(resize([n('a', 0, 0, 4)], 'a', 2.5)[0].length, 4);
});

test('unknown ids leave the part unchanged', () => {
  const notes = [n('a', 0, 0, 4)];
  assert.equal(resize(notes, 'zzz', 2), notes);
  assert.equal(move(notes, 'zzz', 1, 1), notes);
  assert.deepEqual(remove(notes, 'zzz'), notes);
});

test('remove deletes one note', () => {
  assert.deepEqual(remove([n('a', 0, 0, 4), n('b', 1, 0, 4)], 'a'), [n('b', 1, 0, 4)]);
});
