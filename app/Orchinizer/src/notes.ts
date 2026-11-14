// Pure note-editor logic: no React, so it's testable with `npm test`. Mirrors the server's validateNotes rules.
//
// Everyone writes on one shared sheet (the song). `notes` is this player's part; `others` is every other
// player's notes, which this player's notes must fit around. The song is monophonic: no two notes overlap,
// on any row. Notes may touch: MIN_GAP_STEPS of rest (currently 0) separate one note's end from the next start.
import { LOOP_STEPS, MAX_NOTE_STEPS, MAX_NOTES, MIN_GAP_STEPS, NOTE_ROWS, type Note } from '../../../protocol/messages.ts';

/** Whether a and b clash: overlapping, or (if MIN_GAP_STEPS > 0) without that much rest between them. */
const tooClose = (a: Note, b: Note) =>
  a.start < b.start + b.length + MIN_GAP_STEPS && b.start < a.start + a.length + MIN_GAP_STEPS;

/** Whether n keeps the single-note rules: whole steps, on the staff, 1..MAX_NOTE_STEPS long, inside the song. */
function inBounds(n: Note) {
  return (
    Number.isInteger(n.row) && Number.isInteger(n.start) && Number.isInteger(n.length) &&
    n.row >= 0 && n.row < NOTE_ROWS &&
    n.start >= 0 && n.length >= 1 && n.length <= MAX_NOTE_STEPS && n.start + n.length <= LOOP_STEPS
  );
}

/** The note n would clash with: one of the player's own (other than n itself) or another player's. */
export function conflict(notes: Note[], n: Note, others: Note[] = []): Note | undefined {
  return notes.find((o) => o.id !== n.id && tooClose(o, n)) ?? others.find((o) => tooClose(o, n));
}

/** Whether n is a valid note among the player's `notes` and everyone else's. Positions must be whole steps: the server's fields are ints. */
export function fits(notes: Note[], n: Note, others: Note[] = []) {
  return inBounds(n) && !conflict(notes, n, others);
}

/** Tap on an empty spot: a 1-beat note, shortened to fit. Returns null if no note can go there. */
export function place(notes: Note[], row: number, start: number, id: string, others: Note[] = []): Note[] | null {
  if (notes.length >= MAX_NOTES || notes.some((n) => n.id === id)) return null;
  for (let len = 4; len >= 1; len--) {
    const n = { id, row, start, length: len };
    if (fits(notes, n, others)) return [...notes, n];
  }
  return null;
}

export const resize = (notes: Note[], id: string, length: number, others: Note[] = []) =>
  update(notes, id, (n) => ({ ...n, length }), others);
export const move = (notes: Note[], id: string, row: number, start: number, others: Note[] = []) =>
  update(notes, id, (n) => ({ ...n, row, start }), others);
export const remove = (notes: Note[], id: string) => notes.filter((n) => n.id !== id);

/** Applies f to one note. An unknown id or an invalid result returns `notes` unchanged, so a bad drag snaps back. */
function update(notes: Note[], id: string, f: (n: Note) => Note, others: Note[]) {
  const old = notes.find((n) => n.id === id);
  if (!old) return notes;
  const changed = f(old);
  return fits(notes, changed, others) ? notes.map((n) => (n.id === id ? changed : n)) : notes;
}
