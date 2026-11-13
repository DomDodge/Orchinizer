import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/pointer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function sensor(os = 'ios') {
  const control = { available: true, granted: true, fail: false, checks: 0, requests: 0, listeners: 0 };
  const DeviceMotion = {
    async isAvailableAsync() { control.checks++; if (control.fail) throw new Error('Unavailable'); return control.available; },
    async requestPermissionsAsync() { control.requests++; return { granted: control.granted }; },
    setUpdateInterval() {},
    addListener() { control.listeners++; },
  };
  const api: any = {};
  runInNewContext(source, { exports: api, require: (name: string) => {
    if (name === 'expo-sensors') return { DeviceMotion };
    if (name === 'react-native') return { Platform: { OS: os } };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { api, control };
}

test('browser and unavailable sensors return false without requesting permission', async () => {
  const web = sensor('web');
  assert.equal(await web.api.startMotion(), false);
  assert.equal(web.control.checks, 0);
  const native = sensor(); native.control.available = false;
  assert.equal(await native.api.startMotion(), false);
  assert.equal(native.control.requests, 0);
  assert.equal(native.control.listeners, 0);
});
test('denied permission can be retried without adding duplicate sensor subscriptions', async () => {
  const { api, control } = sensor(); control.granted = false;
  assert.equal(await api.startMotion(), false);
  assert.equal(control.listeners, 0);
  control.granted = true;
  const results = await Promise.all([api.startMotion(), api.startMotion()]);
  assert.deepEqual(results, [true, true]);
  assert.equal(control.requests, 2);
  assert.equal(control.listeners, 1);
  assert.equal(await api.startMotion(), true);
  assert.equal(control.listeners, 1);
});
test('sensor errors offer fallback and allow a later retry', async () => {
  const { api, control } = sensor(); control.fail = true;
  assert.equal(await api.startMotion(), false);
  control.fail = false;
  assert.equal(await api.startMotion(), true);
});
