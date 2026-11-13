// Pure note-editor logic: no React, so it's testable with `npm test`. Mirrors the server's validateNotes rules.
import { LOOP_STEPS, MAX_NOTES, ROWS, type Note } from '../../../protocol/messages.ts';

const overlaps = (a: Note, b: Note) =>
  a.row === b.row && a.id !== b.id && a.start < b.start + b.length && b.start < a.start + a.length;

/** Whether n is a valid note among the others in `notes`. Positions must be whole steps: the server's fields are ints. */
export function fits(notes: Note[], n: Note) {
  return (
    Number.isInteger(n.row) && Number.isInteger(n.start) && Number.isInteger(n.length) &&
    n.row >= 0 && n.row < ROWS &&
    n.start >= 0 && n.length >= 1 && n.start + n.length <= LOOP_STEPS &&
    !notes.some((o) => overlaps(o, n))
  );
}

/** Tap on an empty cell: a 1-beat note, shortened to fit. Returns null if no note can go there. */
export function place(notes: Note[], row: number, start: number, id: string): Note[] | null {
  if (notes.length >= MAX_NOTES || notes.some((n) => n.id === id)) return null;
  for (let len = 4; len >= 1; len--) {
    const n = { id, row, start, length: len };
    if (fits(notes, n)) return [...notes, n];
  }
  return null;
}

export const resize = (notes: Note[], id: string, length: number) =>
  update(notes, id, (n) => ({ ...n, length }));
export const move = (notes: Note[], id: string, row: number, start: number) =>
  update(notes, id, (n) => ({ ...n, row, start }));
export const remove = (notes: Note[], id: string) => notes.filter((n) => n.id !== id);

/** Applies f to one note. An unknown id or an invalid result returns `notes` unchanged, so a bad drag snaps back. */
function update(notes: Note[], id: string, f: (n: Note) => Note) {
  const old = notes.find((n) => n.id === id);
  if (!old) return notes;
  const changed = f(old);
  return fits(notes, changed) ? notes.map((n) => (n.id === id ? changed : n)) : notes;
}
