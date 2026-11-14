// A player's part, whichever editor their phone used, as one list of notes.
//
// Phones write notes on one shared sheet, the song: `notes`: [{ id, row, start, length,
// instrument? }] in 16th-note steps over SONG_STEPS (16 bars), each player's part a slice of
// it. Older phones may send a grid (5 rows x 8 eighth notes, one bar) instead. See /protocol.
// Everything here is in 16th-note steps. Rows are chromatic (semitones above the instrument's C);
// a grid's 5 rows are the major pentatonic, so they map onto those.
export const STEPS_PER_BEAT = 4
const GRID_ROWS = [0, 2, 4, 7, 9]
export const SONG_STEPS = 256 // 16 bars; /protocol LOOP_STEPS

// -> { loopSteps, notes: [{ row, start, length, instrument, fromGrid }] }
// `instrument` is '' for "the player's own instrument". Grid notes (fromGrid) are drawn as
// dots on the TV; they play for an eighth note.
export function partNotes(pattern) {
  if (pattern?.notes?.length) {
    return {
      loopSteps: SONG_STEPS,
      notes: pattern.notes.map((n) => ({
        row: n.row,
        start: n.start,
        length: Math.max(1, n.length),
        instrument: n.instrument || '',
        fromGrid: false,
      })),
    }
  }
  const notes = []
  const grid = pattern?.grid || []
  for (let step = 0; step < 8; step++) {
    for (let row = 0; row < 5; row++) {
      if (grid[row]?.[step]) notes.push({ row: GRID_ROWS[row], start: step * 2, length: 2, instrument: '', fromGrid: true })
    }
  }
  return { loopSteps: 16, notes }
}

export const hasNotes = (pattern) => partNotes(pattern).notes.length > 0
