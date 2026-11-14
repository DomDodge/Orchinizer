import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as contract from '../../../protocol/messages.ts';
import * as notesLogic from '../src/notes.ts';
import { noteName } from '../src/protocol.ts';

// Exercise the rendered cell's press handler with the real note rules, without native modules.
const source = ts.transpileModule(readFileSync(new URL('../src/components/NoteEditor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function editor(disabled = false, rows = contract.ROWS) {
  let notes: contract.Note[] = [];
  const previews: contract.Note[] = [];
  const state: any[] = [];
  let cursor = 0;
  const api: any = {};
  const jsx = (type: any, props: any) => ({ type, props });
  runInNewContext(source, { exports: api, require: (name: string) => {
    switch (name) {
      case 'react/jsx-runtime': return { jsx, jsxs: jsx };
      case 'react': return { useState: (initial: any) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: any) => { state[index] = value; }];
      }, useEffect: () => {}, useRef: (current: any) => ({ current }) };
      case 'react-native': return { Pressable: 'Pressable', View: 'View', Text: 'Text', StyleSheet: { create: (s: any) => s, hairlineWidth: 1 } };
      case 'react-native-gesture-handler': return {};
      case 'expo-haptics': return { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Error: 'error' } };
      case '../../../../protocol/messages.ts': return contract;
      case '../notes': return notesLogic;
      case '../protocol': return { noteName };
      case './ui': return { DIM: '#888', FG: '#fff' };
      default: throw new Error(`Unexpected import: ${name}`);
    }
  } });
  const render = () => {
    cursor = 0;
    return api.NoteEditor({ notes, disabled, rows, color: '#fff', keyName: 'C', onChange: (next: contract.Note[]) => { notes = next; }, onPlace: (n: contract.Note) => previews.push(n) });
  };
  function find(node: any, match: (node: any) => boolean): any {
    if (!node || typeof node !== 'object') return;
    if (match(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child, match);
      if (result) return result;
    }
  }
  const cell = (label: string) => find(render(), n => n.props?.accessibilityLabel === label);
  const press = (label: string) => {
    const target = cell(label);
    assert.ok(target, `Missing touch target: ${label}`);
    if (!target.props.disabled) target.props.onPress();
  };
  return { render, find, cell, press, previews, notes: () => notes };
}

test('tapping an empty square places and previews the correct note', () => {
  const e = editor();
  e.press('Add A, bar 1, step 1');
  assert.equal(e.notes().length, 1);
  assert.equal(e.notes()[0].row, 4);
  assert.equal(e.notes()[0].start, 0);
  assert.equal(e.notes()[0].length, 4);
  assert.equal(e.previews[0], e.notes()[0]);
  e.press('Add A, bar 1, step 1');
  assert.equal(e.notes().length, 1, 'occupied cells do not create overlapping notes');
});

test('switching bars places a note at the end of the second bar', () => {
  const e = editor();
  const button = e.find(e.render(), n => n.type === 'Pressable' && n.props.children?.props?.children === '▶');
  button.props.onPress();
  e.press('Add C, bar 2, step 16');
  assert.equal(e.notes()[0].row, 0);
  assert.equal(e.notes()[0].start, 31);
  assert.equal(e.notes()[0].length, 4, 'the song runs on past bar 2, so the note gets a full beat');
});

test('a locked editor cannot add notes; a reduced row count maps correctly', () => {
  const locked = editor(true);
  locked.press('Add C, bar 1, step 1');
  assert.equal(locked.notes().length, 0);
  const short = editor(false, 3);
  short.press('Add E, bar 1, step 2');
  assert.equal(short.notes()[0].row, 2);
  assert.equal(short.notes()[0].start, 1);
});
