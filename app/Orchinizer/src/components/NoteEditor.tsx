// Piano-roll note editor: pitch runs up, time runs across, a note is a bar whose width is its length.
// All the rules live in notes.ts; this file only turns touches into calls to it.
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  useLongPressGesture,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import { LOOP_STEPS, MAX_NOTES, ROWS, STEPS_PER_BEAT, type Note } from '../../../../protocol/messages.ts';
import { fits, move, place, remove, resize } from '../notes';
import { noteName } from '../protocol';
import { DIM, FG } from './ui';

const BAR_STEPS = STEPS_PER_BEAT * 4; // one bar of 4/4 on screen at a time
const BARS = LOOP_STEPS / BAR_STEPS;
const ROW_H = 52;
const LABEL_W = 40;
const HANDLE_W = 22; // touch area on a note's right edge for stretching

let idN = 0;
const newId = () => `${Date.now().toString(36)}-${idN++}`;

type Props = {
  notes: Note[];
  /** Called once per finished gesture with the new part. Not called if nothing changed. */
  onChange: (next: Note[]) => void;
  color: string;
  keyName: string;
  /** Locks the editor, e.g. when the compose timer runs out. */
  disabled?: boolean;
  /** For an audio preview when a note is placed. */
  onPlace?: (note: Note) => void;
  /** How many rows to show, from row 0 up (drums use 3). At most ROWS. */
  rows?: number;
  /** Row names, indexed by row. Defaults to the note names in keyName. */
  rowLabels?: string[];
  /** Step the preview is playing (0..LOOP_STEPS-1), or -1 for none. */
  playhead?: number;
};

export function NoteEditor({ notes, onChange, color, keyName, disabled = false, onPlace, rows = ROWS, rowLabels, playhead = -1 }: Props) {
  const [bar, setBar] = useState(0);
  const [width, setWidth] = useState(0);
  const cellW = width / BAR_STEPS;
  const offset = bar * BAR_STEPS;
  const full = notes.length >= MAX_NOTES;

  const commit = (next: Note[]) => {
    if (next !== notes) onChange(next);
  };

  const tap = useTapGesture({
    runOnJS: true,
    enabled: !disabled && width > 0,
    onActivate: (e) => {
      const start = offset + Math.floor(e.x / cellW);
      const row = rows - 1 - Math.floor(e.y / ROW_H); // top row = highest note
      if (full) return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const next = place(notes, row, start, newId());
      if (!next) return;
      Haptics.selectionAsync();
      onChange(next);
      onPlace?.(next[next.length - 1]);
    },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {Array.from({ length: BARS }, (_, b) => (
          <Pressable key={b} onPress={() => setBar(b)} style={[styles.barBtn, b === bar && styles.barBtnOn]}>
            <Text style={[styles.barText, b === bar && styles.barTextOn]}>Bar {b + 1}</Text>
          </Pressable>
        ))}
        <Text style={[styles.count, full && { color: '#FF5252' }]}>
          {notes.length} / {MAX_NOTES} notes
        </Text>
      </View>

      <View style={styles.roll}>
        <View style={{ width: LABEL_W }}>
          {Array.from({ length: rows }, (_, i) => (
            <Text key={i} style={styles.label}>
              {rowLabels?.[rows - 1 - i] ?? noteName(keyName, rows - 1 - i)}
            </Text>
          ))}
        </View>

        <GestureDetector gesture={tap}>
          <View style={[styles.grid, { height: ROW_H * rows }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
            {/* Background: rows, with every beat shaded so notes are easy to line up. */}
            {Array.from({ length: rows }, (_, i) => (
              <View key={i} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
                {Array.from({ length: BAR_STEPS }, (_, s) => (
                  <View key={s} style={[styles.step, s % STEPS_PER_BEAT === 0 && styles.beat]} />
                ))}
              </View>
            ))}
            {width > 0 &&
              notes
                .filter((n) => n.start < offset + BAR_STEPS && n.start + n.length > offset)
                .map((n) => (
                  <NoteView
                    key={n.id}
                    note={n}
                    notes={notes}
                    cellW={cellW}
                    offset={offset}
                    color={color}
                    disabled={disabled}
                    commit={commit}
                    rows={rows}
                  />
                ))}
            {width > 0 && playhead >= offset && playhead < offset + BAR_STEPS && (
              <View pointerEvents="none" style={[styles.playhead, { left: (playhead - offset) * cellW }]} />
            )}
          </View>
        </GestureDetector>
      </View>

      <Text style={styles.hint}>Tap to add · drag to move · drag the right edge to stretch · hold to delete</Text>
    </View>
  );
}

type Drag = { kind: 'move' | 'resize'; dx: number; dy: number };

/** Where a note would land if the finger lifted now, snapped to whole steps and rows. */
function landing(note: Note, drag: Drag | null, cellW: number): Note {
  if (!drag) return note;
  const dSteps = Math.round(drag.dx / cellW);
  if (drag.kind === 'resize') return { ...note, length: Math.max(1, note.length + dSteps) };
  return { ...note, row: note.row - Math.round(drag.dy / ROW_H), start: note.start + dSteps };
}

function NoteView({
  note,
  notes,
  cellW,
  offset,
  color,
  disabled,
  commit,
  rows,
}: {
  note: Note;
  notes: Note[];
  cellW: number;
  offset: number;
  color: string;
  disabled: boolean;
  commit: (next: Note[]) => void;
  rows: number;
}) {
  const [drag, setDragState] = useState<Drag | null>(null);
  // The drop reads the ref: the finger can lift before the last update has re-rendered.
  const latest = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    latest.current = d;
    setDragState(d);
  };

  const candidate = landing(note, drag, cellW);
  const valid = !drag || (candidate.row < rows && fits(notes, candidate));

  const finish = () => {
    const d = latest.current;
    const c = landing(note, d, cellW);
    if (d?.kind === 'move' && c.row < rows) commit(move(notes, note.id, c.row, c.start));
    else if (d?.kind === 'resize') commit(resize(notes, note.id, c.length));
    setDrag(null);
  };

  const body = usePanGesture({
    runOnJS: true,
    enabled: !disabled,
    minDistance: 6,
    onUpdate: (e) => setDrag({ kind: 'move', dx: e.translationX, dy: e.translationY }),
    onDeactivate: finish,
    onFinalize: () => setDrag(null),
  });
  const hold = useLongPressGesture({
    runOnJS: true,
    enabled: !disabled,
    minDuration: 450,
    onActivate: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      commit(remove(notes, note.id));
    },
  });
  const edge = usePanGesture({
    runOnJS: true,
    enabled: !disabled,
    minDistance: 2,
    onUpdate: (e) => setDrag({ kind: 'resize', dx: e.translationX, dy: 0 }),
    onDeactivate: finish,
    onFinalize: () => setDrag(null),
  });
  // Whichever activates first wins: moving the finger starts a drag, holding still deletes.
  const bodyGesture = useCompetingGestures(body, hold);

  const left = (candidate.start - offset) * cellW;
  const top = (rows - 1 - candidate.row) * ROW_H;
  const w = candidate.length * cellW;

  return (
    <View
      style={[
        styles.note,
        { left, top, width: w, backgroundColor: color, opacity: drag ? 0.75 : 1 },
        !valid && styles.noteInvalid,
      ]}
    >
      <GestureDetector gesture={bodyGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
      <GestureDetector gesture={edge}>
        <View style={styles.handle}>
          <View style={styles.grip} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 2, borderColor: '#33334A' },
  barBtnOn: { backgroundColor: FG, borderColor: FG },
  barText: { color: FG, fontWeight: '800' },
  barTextOn: { color: '#0B0B12' },
  count: { marginLeft: 'auto', color: FG, fontWeight: '800' },
  roll: { flexDirection: 'row' },
  label: { height: ROW_H, lineHeight: ROW_H, color: DIM, fontWeight: '700', fontSize: 14 },
  grid: { flex: 1, overflow: 'hidden', borderRadius: 8 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#FFFFFF' },
  row: { height: ROW_H, flexDirection: 'row', backgroundColor: '#15151F' },
  rowAlt: { backgroundColor: '#1A1A27' },
  step: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: '#26263A' },
  beat: { borderLeftWidth: 2, borderColor: '#33334A' },
  note: { position: 'absolute', height: ROW_H - 6, marginTop: 3, borderRadius: 8 },
  noteInvalid: { backgroundColor: '#FF5252' },
  handle: { position: 'absolute', right: 0, top: 0, bottom: 0, width: HANDLE_W, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 4, height: 18, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.35)' },
  hint: { color: DIM, fontSize: 13, textAlign: 'center' },
});
