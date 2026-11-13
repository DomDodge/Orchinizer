import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { keyRoot, SCALE } from './protocol.ts';

const source = ts.transpileModule(readFileSync(new URL('./audio.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('every round key can preview all five rows, including high Bb notes', () => {
  const played: { source: string; rate: number; correctPitch: boolean }[] = [];
  const sounds = Object.fromEntries(['bass', 'pad', 'lead', 'drums'].map(voice => [voice,
    Array.from({ length: voice === 'drums' ? 3 : 19 }, (_, i) => `${voice}_${i}`)]));
  const api: any = {};
  runInNewContext(source, {
    exports: api,
    require: (name: string) => {
      if (name === './protocol') return { keyRoot, SCALE };
      if (name === './sounds.gen') return { SOUNDS: sounds };
      assert.equal(name, 'expo-audio');
      return { createAudioPlayer: (source: string) => {
        assert.ok(source, 'must resolve a bundled sound');
        return { playbackRate: 1, shouldCorrectPitch: true, seekTo() {}, play() {
          played.push({ source, rate: this.playbackRate, correctPitch: this.shouldCorrectPitch });
        } };
      } };
    },
  });
  for (const key of ['C', 'G', 'F', 'D', 'A', 'E', 'Bb', 'Eb']) {
    api.preload('lead', key);
    for (let row = 0; row < 5; row++) api.playNote('lead', key, row);
  }
  assert.equal(played.length, 40);
  assert.deepEqual(played[34], { source: 'lead_7', rate: 2, correctPitch: false });
});
