import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENT_GROUPS } from '../../../protocol/messages.ts';
import { ALL_CATEGORIES, INSTRUMENTS, inKey, isSharp, keyRoot, noteLabel, rowName } from './protocol.ts';

test('every shared instrument has matching frontend metadata and category', () => {
  assert.deepEqual(Object.keys(INSTRUMENTS).sort(), Object.values(INSTRUMENT_GROUPS).flat().sort());
  assert.deepEqual(ALL_CATEGORIES, Object.keys(INSTRUMENT_GROUPS));
  for (const [category, instruments] of Object.entries(INSTRUMENT_GROUPS)) {
    for (const instrument of instruments) assert.equal(INSTRUMENTS[instrument].category, category);
  }
});
test('server flat keys map to the correct roots', () => {
  assert.equal(keyRoot('Bb'), 10);
  assert.equal(keyRoot('Eb'), 3);
});
test("note-editor rows are chromatic from each instrument's C", () => {
  assert.deepEqual(Array.from({ length: 13 }, (_, r) => rowName(r)), ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C']);
  assert.equal(rowName(20), 'G#');
  assert.equal(noteLabel('violin', 0), 'C5');
  assert.equal(noteLabel('violin', 13), 'C#6');
  assert.equal(noteLabel('tuba', 20), 'G#3');
  assert.equal(isSharp(1), true);
  assert.equal(isSharp(4), false);
  // Bb major pentatonic: Bb C D F G.
  assert.deepEqual([0, 1, 2, 5, 7, 10, 11].map((r) => inKey('Bb', r)), [true, false, true, true, true, true, false]);
});
