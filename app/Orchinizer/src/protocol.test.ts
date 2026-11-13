import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENT_GROUPS } from '../../../protocol/messages.ts';
import { ALL_CATEGORIES, INSTRUMENTS, keyRoot, noteName } from './protocol.ts';

test('every shared instrument has matching frontend metadata and category', () => {
  assert.deepEqual(Object.keys(INSTRUMENTS).sort(), Object.values(INSTRUMENT_GROUPS).flat().sort());
  assert.deepEqual(ALL_CATEGORIES, Object.keys(INSTRUMENT_GROUPS));
  for (const [category, instruments] of Object.entries(INSTRUMENT_GROUPS)) {
    for (const instrument of instruments) assert.equal(INSTRUMENTS[instrument].category, category);
  }
});
test('server flat keys map to the correct preview pitches', () => {
  assert.equal(keyRoot('Bb'), 10);
  assert.equal(keyRoot('Eb'), 3);
  assert.equal(noteName('Bb', 0), 'A#');
  assert.equal(noteName('Eb', 4), 'C');
});
