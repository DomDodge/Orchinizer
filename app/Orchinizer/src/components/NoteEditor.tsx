// Piano-roll note editor: pitch runs up, time runs across, a note is a bar whose width is its length.
// All the rules live in notes.ts; this file only turns touches into calls to it.
// Touch handling is plain React Native: one Pressable per grid cell for taps (so no tap coordinates are
// needed, which differ by platform), responder props for dragging notes.
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { LOOP_STEPS, MAX_NOTES, ROWS, STEPS_PER_BEAT, type Note } from '../../../../protocol/messages.ts';
import { fits, move, place, remove, resize } from '../notes';
import { noteName } from '../protocol';
import { DIM, FG } from './ui';

const BAR_STEPS = STEPS_PER_BEAT * 4; // one bar of 4/4 on screen at a time
const BARS = LOOP_STEPS / BAR_STEPS;
const ROW_H = 52;
const LABEL_W = 40;
const HANDLE_W = 22; // touch area on a note's right edge for stretching
const HOLD_MS = 450; // hold a note still this long to delete it
const MOVE_SLOP = 6; // px the finger must travel before a hold becomes a drag
const EDGE_SLOP = 2;

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
  /** For an audio preview when a note is placed, moved or stretched. */
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

  // A tap on an empty cell adds a note there. Notes are drawn on top of the cells, so they get their own touches.
  const addNote = (row: number, start: number) => {
    if (disabled) return;
    if (full) return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    const next = place(notes, row, start, newId());
    if (!next) return;
    Haptics.selectionAsync();
    onChange(next);
    onPlace?.(next[next.length - 1]);
  };

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

        <View style={[styles.grid, { height: ROW_H * rows }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          {/* The cells: rows top (highest note) to bottom, every beat shaded so notes are easy to line up. */}
          <View style={StyleSheet.absoluteFill}>
            {Array.from({ length: rows }, (_, i) => (
              <View key={i} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
                {Array.from({ length: BAR_STEPS }, (_, s) => (
                  <Pressable
                    key={s}
                    disabled={disabled}
                    onPress={() => addNote(rows - 1 - i, offset + s)}
                    style={[styles.step, s % STEPS_PER_BEAT === 0 && styles.beat]}
                  />
                ))}
              </View>
            ))}
          </View>
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
                  onPlace={onPlace}
                  rows={rows}
                />
              ))}
          {width > 0 && playhead >= offset && playhead < offset + BAR_STEPS && (
            <View pointerEvents="none" style={[styles.playhead, { left: (playhead - offset) * cellW }]} />
          )}
        </View>
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

/** One finger on a note, from touch-down to lift. Positions are page coordinates, which don't shift as the note moves. */
type Touch = { kind: Drag['kind']; x0: number; y0: number; dragging: boolean; deleted: boolean };

function NoteView({
  note,
  notes,
  cellW,
  offset,
  color,
  disabled,
  commit,
  onPlace,
  rows,
}: {
  note: Note;
  notes: Note[];
  cellW: number;
  offset: number;
  color: string;
  disabled: boolean;
  commit: (next: Note[]) => void;
  onPlace?: (note: Note) => void;
  rows: number;
}) {
  const [drag, setDragState] = useState<Drag | null>(null);
  // The drop reads the ref: the finger can lift before the last update has re-rendered.
  const latest = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    latest.current = d;
    setDragState(d);
  };

  const touch = useRef<Touch | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => clearHold, []);

  const finish = () => {
    const d = latest.current;
    const c = landing(note, d, cellW);
    let next = notes;
    if (d?.kind === 'move' && c.row < rows) next = move(notes, note.id, c.row, c.start);
    else if (d?.kind === 'resize') next = resize(notes, note.id, c.length);
    setDrag(null);
    if (next === notes) return; // invalid drop: it snaps back
    commit(next);
    const moved = next.find((n) => n.id === note.id);
    if (moved) onPlace?.(moved); // hear where it landed, for as long as it now lasts
  };

  // Handlers for React Native's responder props, rebuilt every render so they always see the current props.
  const canStart = () => !disabled;
  const keep = () => false; // don't hand the touch to anyone else while the finger is down

  const grant = (kind: Drag['kind'], e: GestureResponderEvent) => {
    const t: Touch = { kind, x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, dragging: false, deleted: false };
    touch.current = t;
    // Holding the body still deletes the note; the stretch handle only stretches.
    if (kind === 'move') {
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        t.deleted = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        commit(remove(notes, note.id));
      }, HOLD_MS);
    }
  };

  const track = (e: GestureResponderEvent) => {
    const t = touch.current;
    if (!t || t.deleted) return;
    const dx = e.nativeEvent.pageX - t.x0;
    const dy = e.nativeEvent.pageY - t.y0;
    if (!t.dragging && Math.hypot(dx, dy) < (t.kind === 'move' ? MOVE_SLOP : EDGE_SLOP)) return;
    if (!t.dragging) clearHold();
    t.dragging = true;
    setDrag({ kind: t.kind, dx, dy: t.kind === 'move' ? dy : 0 });
  };

  const release = () => {
    clearHold();
    const t = touch.current;
    touch.current = null;
    if (t?.dragging && !t.deleted) finish();
  };

  const terminate = () => {
    clearHold();
    touch.current = null;
    setDrag(null);
  };

  const candidate = landing(note, drag, cellW);
  const valid = !drag || (candidate.row < rows && fits(notes, candidate));
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
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={canStart}
        onResponderTerminationRequest={keep}
        onResponderGrant={(e) => grant('move', e)}
        onResponderMove={track}
        onResponderRelease={release}
        onResponderTerminate={terminate}
      />
      <View
        style={styles.handle}
        onStartShouldSetResponder={canStart}
        onResponderTerminationRequest={keep}
        onResponderGrant={(e) => grant('resize', e)}
        onResponderMove={track}
        onResponderRelease={release}
        onResponderTerminate={terminate}
      >
        <View pointerEvents="none" style={styles.grip} />
      </View>
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
