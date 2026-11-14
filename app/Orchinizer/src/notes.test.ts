import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_STEPS, MAX_NOTE_STEPS, MAX_NOTES, MIN_GAP_STEPS, ROWS, type Note } from '../../../protocol/messages.ts';
import { conflict, fits, move, place, remove, resize } from './notes.ts';

const n = (id: string, row: number, start: number, length: number): Note => ({ id, row, start, length });

test('place adds a 1-beat note', () => {
  assert.deepEqual(place([], 2, 0, 'a'), [n('a', 2, 0, 4)]);
});

test('place shortens to leave a rest before the next note, and to fit the song', () => {
  // b starts at 4: a must end by 4 - MIN_GAP_STEPS.
  assert.deepEqual(place([n('b', 1, 4, 4)], 3, 0, 'a')?.at(-1), n('a', 3, 0, 4 - MIN_GAP_STEPS));
  assert.deepEqual(place([], 0, LOOP_STEPS - 1, 'a'), [n('a', 0, LOOP_STEPS - 1, 1)]);
});

test('place refuses a taken or too-close spot, a full budget, a bad row and a reused id', () => {
  assert.equal(place([n('b', 1, 0, 4)], 1, 2, 'a'), null); // inside b
  assert.equal(place([n('b', 1, 0, 4)], 3, 4, 'a'), null); // right after b, no rest
  const full = Array.from({ length: MAX_NOTES }, (_, i) => n(`n${i}`, 0, i * 8, 1));
  assert.equal(place(full, 0, LOOP_STEPS - 1, 'x'), null);
  assert.equal(place([], ROWS, 0, 'a'), null);
  assert.equal(place([], -1, 0, 'a'), null);
  assert.equal(place([n('a', 0, 0, 1)], 3, 8, 'a'), null);
});

test('the song is monophonic: no chords, across rows or players', () => {
  assert.equal(place([n('a', 0, 0, 8)], 1, 0, 'b'), null);
  assert.equal(place([], 4, 2, 'mine', [n('theirs', 0, 0, 4)]), null);
  assert.equal(place([], 4, 4 + MIN_GAP_STEPS, 'mine', [n('theirs', 0, 0, 4)])?.length, 1);
});

test("conflict names the other player's note in the way", () => {
  const theirs = n('s1', 2, 16, 4);
  assert.equal(conflict([], n('a', 0, 18, 1), [theirs]), theirs);
  assert.equal(conflict([], n('a', 0, 20 + MIN_GAP_STEPS, 1), [theirs]), undefined);
  assert.equal(conflict([n('a', 0, 0, 2)], n('a', 0, 1, 2)), undefined); // a note doesn't clash with itself
});

test('resize stretches and shrinks, but not past the max length, the song or into a neighbor', () => {
  const notes = [n('a', 0, 0, 4), n('b', 3, 7, 4)];
  assert.equal(resize(notes, 'a', 7 - MIN_GAP_STEPS)[0].length, 7 - MIN_GAP_STEPS); // leaves the rest
  assert.equal(resize(notes, 'a', 1)[0].length, 1);
  assert.equal(resize(notes, 'a', 7), notes); // no rest before b: snaps back
  assert.equal(resize([n('a', 0, 0, 4)], 'a', MAX_NOTE_STEPS)[0].length, MAX_NOTE_STEPS);
  assert.equal(resize([n('a', 0, 0, 4)], 'a', MAX_NOTE_STEPS + 1)[0].length, 4); // too long
  assert.equal(resize([n('a', 0, LOOP_STEPS - 4, 4)], 'a', 5)[0].length, 4); // past the song
  assert.equal(resize(notes, 'a', 0), notes);
  assert.equal(resize([n('a', 0, 0, 2)], 'a', 6, [n('t', 1, 6, 2)])[0].length, 2); // into another player's note
});

test('move changes time and pitch, but not near another note or off the staff', () => {
  const notes = [n('a', 0, 0, 4), n('b', 1, 20, 4)];
  assert.deepEqual(move(notes, 'a', 2, 12)[0], n('a', 2, 12, 4));
  assert.equal(move(notes, 'a', 3, 18), notes); // onto b, even on another row
  assert.equal(move(notes, 'a', ROWS, 0), notes);
  assert.equal(move(notes, 'a', 0, LOOP_STEPS - 3), notes); // would run past the song
  assert.deepEqual(move(notes, 'a', 0, 0), notes); // a note doesn't collide with itself
  assert.equal(move(notes, 'a', 0, 40, [n('t', 0, 42, 2)]), notes); // onto another player's note
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
  assert.deepEqual(remove([n('a', 0, 0, 4), n('b', 1, 8, 4)], 'a'), [n('b', 1, 8, 4)]);
});
