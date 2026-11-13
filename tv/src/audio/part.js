// A player's part, whichever editor their phone used, as one list of notes.
//
// Phones send either a grid (5 rows x 8 eighth notes, one bar) or, from the note editor,
// `notes`: [{ id, row, start, length, instrument? }] in 16th-note steps looping every
// 32 steps (2 bars). See /protocol. Everything here is in 16th-note steps.
export const STEPS_PER_BEAT = 4

// -> { loopSteps, notes: [{ row, start, length, instrument, fromGrid }] }
// `instrument` is '' for "the player's own instrument". Grid notes (fromGrid) are drawn as
// dots on the TV; they play for an eighth note.
export function partNotes(pattern) {
  if (pattern?.notes?.length) {
    return {
      loopSteps: 32,
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
      if (grid[row]?.[step]) notes.push({ row, start: step * 2, length: 2, instrument: '', fromGrid: true })
    }
  }
  return { loopSteps: 16, notes }
}

export const hasNotes = (pattern) => partNotes(pattern).notes.length > 0
