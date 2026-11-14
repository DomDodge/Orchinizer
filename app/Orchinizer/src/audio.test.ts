import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { INSTRUMENT_GROUPS, NOTE_ROWS } from '../../../protocol/messages.ts';

const source = ts.transpileModule(readFileSync(new URL('./audio.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const ALL = Object.values(INSTRUMENT_GROUPS).flat();
// Stand-in for sounds.gen: one recording per row.
const sounds = Object.fromEntries(ALL.map((id) => [id, Array.from({ length: NOTE_ROWS }, (_, n) => `${id}_${n}`)]));

type Played = { source: string; rate: number };

function load(overrides: Record<string, unknown> = {}) {
  const played: Played[] = [];
  const log: string[] = [];
  const created: string[] = [];
  const api: any = {};
  runInNewContext(source, {
    exports: api,
    ...overrides,
    require: (name: string) => {
      if (name === './protocol') return { NOTE_ROWS };
      if (name === './sounds.gen') return { SOUNDS: sounds };
      assert.equal(name, 'expo-audio');
      return {
        setAudioModeAsync: async () => {},
        createAudioPlayer: (source: string) => {
          assert.ok(source, 'must resolve a bundled sound');
          created.push(source);
          return { playbackRate: 1, seekTo() {},
            play() {
              played.push({ source, rate: this.playbackRate });
              log.push(`play ${source}`);
            },
            pause() { log.push(`stop ${source}`); } };
        },
      };
    },
  });
  return { api, played, log, created };
}

test('every instrument has a recording for every row, and each file exists', () => {
  // Read as text: the requires only resolve under Metro.
  const gen = readFileSync(new URL('./sounds.gen.ts', import.meta.url), 'utf8');
  for (const id of ALL) {
    const line = gen.split('\n').find((l) => l.startsWith(`  ${id}: [`));
    assert.ok(line, `no sounds for ${id}`);
    const files = [...line.matchAll(/require\('(.+?)'\)/g)].map((m) => m[1]);
    assert.deepEqual(files, Array.from({ length: NOTE_ROWS }, (_, n) => `../assets/sounds/${id}_${n}.m4a`), id);
    for (const f of files) assert.ok(existsSync(new URL(f, import.meta.url)), `missing ${f}`);
  }
});

test('row n plays the instrument\'s nth recording, never changing the playback rate', () => {
  const { api, played } = load();
  for (const id of ALL) {
    api.preload(id);
    for (let row = 0; row < NOTE_ROWS; row++) api.playNote(id, row);
  }
  assert.equal(played.length, ALL.length * NOTE_ROWS);
  for (const p of played) assert.equal(p.rate, 1, 'a non-integer playbackRate hangs iOS');
  const { api: a2, played: p2 } = load();
  a2.playNote('violin', 0);
  a2.playNote('violin', 13);
  a2.playNote('tuba', 20);
  assert.deepEqual(p2.map((p) => p.source), ['violin_0', 'violin_13', 'tuba_20']);
});

test('unknown instruments fall back to the piano; rows off the staff are silent', () => {
  const { api, played } = load();
  api.playNote('kazoo', 3);
  api.playNote('violin', NOTE_ROWS);
  assert.deepEqual(played.map((p) => p.source), ['piano_3']);
});

test('preloading makes one player per row', () => {
  const { api, created } = load();
  api.preload('cello');
  assert.equal(created.length, NOTE_ROWS);
  assert.equal(new Set(created).size, NOTE_ROWS);
});

test('playNoteFor stops a stretched note after its length, and a replay cancels the stop', () => {
  const timers: { f: () => void; ms: number; cleared: boolean }[] = [];
  const { api, log } = load({
    setTimeout: (f: () => void, ms: number) => (timers.push({ f, ms, cleared: false }), timers.length - 1),
    clearTimeout: (id: number) => { timers[id].cleared = true; },
  });
  api.playNoteFor('cello', 0, 600);
  assert.equal(timers[0].ms, 600);
  timers[0].f();
  assert.deepEqual(log, ['play cello_0', 'stop cello_0']);

  api.playNoteFor('cello', 0, 600);
  api.playNote('cello', 0); // tapped again before the stop: the old stop must not cut it off
  assert.equal(timers[1].cleared, true);
});
