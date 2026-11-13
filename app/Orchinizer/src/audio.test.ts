import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { INSTRUMENT_GROUPS } from '../../../protocol/messages.ts';
import { instrumentInfo, keyRoot, SCALE } from './protocol.ts';

const source = ts.transpileModule(readFileSync(new URL('./audio.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const SAMPLE_STEP = 4;
const ALL = Object.values(INSTRUMENT_GROUPS).flat();
const KITS = ['drums', 'timpani', 'bongos'];
// Stand-in for sounds.gen: tonal banks at semitones 0, 4, ... 20; kits one sound per row.
const sounds = Object.fromEntries(ALL.map((id) => [id,
  KITS.includes(id) ? [0, 1, 2].map((r) => `${id}_${r}`) : [0, 4, 8, 12, 16, 20].map((s) => `${id}_${s}`)]));

type Played = { source: string; rate: number; correctPitch: boolean };

function load(overrides: Record<string, unknown> = {}) {
  const played: Played[] = [];
  const log: string[] = [];
  const created: string[] = [];
  const api: any = {};
  runInNewContext(source, {
    exports: api,
    ...overrides,
    require: (name: string) => {
      if (name === './protocol') return { instrumentInfo, keyRoot, SCALE };
      if (name === './sounds.gen') return { SOUNDS: sounds, SAMPLE_STEP };
      assert.equal(name, 'expo-audio');
      return {
        setAudioModeAsync: async () => {},
        createAudioPlayer: (source: string) => {
          assert.ok(source, 'must resolve a bundled sound');
          created.push(source);
          return { playbackRate: 1, shouldCorrectPitch: true, seekTo() {},
            play() {
              played.push({ source, rate: this.playbackRate, correctPitch: this.shouldCorrectPitch });
              log.push(`play ${source}`);
            },
            pause() { log.push(`stop ${source}`); } };
        },
      };
    },
  });
  return { api, played, log, created };
}

test('the generated sounds cover every instrument with the expected sample counts', () => {
  // Read as text: the .wav requires only resolve under Metro.
  const gen = readFileSync(new URL('./sounds.gen.ts', import.meta.url), 'utf8');
  assert.match(gen, new RegExp(`SAMPLE_STEP = ${SAMPLE_STEP};`));
  for (const id of ALL) {
    const line = gen.split('\n').find((l) => l.startsWith(`  ${id}: [`));
    assert.ok(line, `no sounds for ${id}`);
    assert.equal(line.match(/require\(/g)?.length, KITS.includes(id) ? 3 : 6, id);
  }
});

test('every instrument previews all its rows in every round key, tuned by a small rate', () => {
  const { api, played } = load();
  for (const id of ALL) {
    const rows = KITS.includes(id) ? 3 : 5;
    for (const key of ['C', 'G', 'F', 'D', 'A', 'E', 'Bb', 'Eb', 'B']) {
      api.preload(id, key);
      for (let row = 0; row < rows; row++) api.playNote(id, key, row);
    }
  }
  for (const p of played) {
    assert.ok(p.rate >= 1 && p.rate < 2 ** (SAMPLE_STEP / 12), `${p.source} rate ${p.rate}`);
    assert.equal(p.correctPitch, false);
  }
  // Violin in B, top row: semitone 11 + 9 = 20, the top sample untransposed.
  const { api: a2, played: p2 } = load();
  a2.playNote('violin', 'B', 4);
  assert.deepEqual(p2[0], { source: 'violin_20', rate: 1, correctPitch: false });
  // Violin in D, row 1: semitone 2 + 2 = 4, the second sample.
  a2.playNote('violin', 'D', 1);
  assert.equal(p2[1].source, 'violin_4');
});

test('instruments sound different, and unknown ones fall back to the piano', () => {
  const { api, played } = load();
  api.playNote('flute', 'C', 0);
  api.playNote('trumpet', 'C', 0);
  api.playNote('kazoo', 'C', 0);
  assert.deepEqual(played.map((p) => p.source), ['flute_0', 'trumpet_0', 'piano_0']);
});

test('two rows tuned from the same sample get separate players', () => {
  const { api, created } = load();
  api.preload('piano', 'C'); // rows at semitones 0, 2, 4, 7, 9
  assert.equal(created.length, 5);
  assert.deepEqual(created.slice(0, 2), ['piano_0', 'piano_0']);
});

test('playNoteFor stops a stretched note after its length, and a replay cancels the stop', () => {
  const timers: { f: () => void; ms: number; cleared: boolean }[] = [];
  const { api, log } = load({
    setTimeout: (f: () => void, ms: number) => (timers.push({ f, ms, cleared: false }), timers.length - 1),
    clearTimeout: (id: number) => { timers[id].cleared = true; },
  });
  api.playNoteFor('cello', 'C', 0, 600);
  assert.equal(timers[0].ms, 600);
  timers[0].f();
  assert.deepEqual(log, ['play cello_0', 'stop cello_0']);

  api.playNoteFor('cello', 'C', 0, 600);
  api.playNote('cello', 'C', 0); // tapped again before the stop: the old stop must not cut it off
  assert.equal(timers[1].cleared, true);

  api.playNoteFor('bongos', 'C', 0, 600);
  assert.equal(timers.length, 2, 'drum hits are not stopped');
});
