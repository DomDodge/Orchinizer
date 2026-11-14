package game

import (
	"fmt"
	"math/rand/v2"
	"sort"

	"orchinizer/protocol"
)

// maxNoteIDLen keeps a phone from stuffing large strings into note ids.
const maxNoteIDLen = 32

// sheetNote is a note on the shared sheet with the name of whoever wrote it,
// for error messages.
type sheetNote struct {
	protocol.Note
	owner string // "" = the player being validated
}

// validateNotes checks one player's note-editor part against the shared
// sheet. It returns "" if the part is valid, or a message for the player
// saying which rule it broke. allowed is the instruments a note may name
// (this game's enabled sections); others is every other player's notes.
//
// The sheet is one monophonic song: no two notes overlap, on any row, and
// MinGapSteps of rest (currently none) separate one note's end from the next.
func validateNotes(notes []protocol.Note, allowed []string, others []sheetNote) string {
	if len(notes) > protocol.MaxNotes {
		return fmt.Sprintf("You can place at most %d notes", protocol.MaxNotes)
	}
	ids := map[string]bool{}
	for i, n := range notes {
		switch {
		case n.ID == "" || len(n.ID) > maxNoteIDLen:
			return fmt.Sprintf("note %d has a bad id", i)
		case ids[n.ID]:
			return fmt.Sprintf("note id %q is used twice", n.ID)
		case n.Row < 0 || n.Row >= protocol.NoteRows:
			return fmt.Sprintf("note %q is off the staff", n.ID)
		case n.Length > protocol.MaxNoteSteps:
			return fmt.Sprintf("Notes can be at most %d steps long", protocol.MaxNoteSteps)
		case n.Start < 0 || n.Length < 1 || n.Start+n.Length > protocol.LoopSteps:
			return fmt.Sprintf("note %q doesn't fit in the song", n.ID)
		case n.Instrument != "" && !contains(allowed, n.Instrument):
			return fmt.Sprintf("note %q uses an instrument that isn't in this game", n.ID)
		}
		ids[n.ID] = true
	}

	sheet := make([]sheetNote, 0, len(notes)+len(others))
	for _, n := range notes {
		sheet = append(sheet, sheetNote{Note: n})
	}
	sheet = append(sheet, others...)
	sort.SliceStable(sheet, func(i, j int) bool { return sheet[i].Start < sheet[j].Start })
	for i := 1; i < len(sheet); i++ {
		a, b := sheet[i-1], sheet[i]
		if a.Start+a.Length+protocol.MinGapSteps <= b.Start {
			continue
		}
		switch {
		case a.owner == "" && b.owner == "":
			return "Two of your notes clash: notes can't overlap"
		case a.owner != "":
			return fmt.Sprintf("Clashes with %s's note", a.owner)
		default:
			return fmt.Sprintf("Clashes with %s's note", b.owner)
		}
	}
	return ""
}

// sheetExcept is every player's notes except p's: what p's part must fit around.
func (r *Room) sheetExcept(p *player) []sheetNote {
	var out []sheetNote
	for _, o := range r.seatOrder() {
		if o == p {
			continue
		}
		for _, n := range o.notes {
			out = append(out, sheetNote{Note: n, owner: o.name})
		}
	}
	return out
}

// autoNotes is how many notes fillNotes writes for a seat with an empty part.
const autoNotes = 8

// fillNotes writes up to want notes for a seat into the free space of the
// sheet, so bots and players who wrote nothing still have a part. Notes land
// on beats, keep every sheet rule, and use the round key's pentatonic scale
// (the editor's rows are chromatic, so random rows would clash); fewer are
// written if the sheet is full.
func fillNotes(sheet []sheetNote, key string, want int, rng *rand.Rand) []protocol.Note {
	rows := scaleRows(key)
	var out []protocol.Note
	starts := rng.Perm(protocol.LoopSteps / protocol.StepsPerBeat)
	degree := rng.IntN(len(rows))
	for _, beat := range starts {
		if len(out) == want {
			break
		}
		// A gentle melody: step up or down one scale degree at a time.
		degree = min(len(rows)-1, max(0, degree+rng.IntN(3)-1))
		n := protocol.Note{
			ID:     fmt.Sprintf("auto-%d", len(out)),
			Row:    rows[degree],
			Start:  beat * protocol.StepsPerBeat,
			Length: 2 * (1 + rng.IntN(2)), // an 8th or a quarter
		}
		trial := append(append([]sheetNote{}, sheet...), sheetNote{Note: n, owner: "auto"})
		if validateNotes(nil, nil, trial) != "" {
			continue
		}
		sheet = append(sheet, sheetNote{Note: n, owner: "auto"})
		out = append(out, n)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// keyRoots: semitones above C for each key a round can be in.
var keyRoots = map[string]int{
	"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
	"F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

// scaleRows is every note-editor row (semitones above the instrument's C) in
// key's major pentatonic scale, lowest first. An unknown key counts as C.
func scaleRows(key string) []int {
	root := keyRoots[key]
	var rows []int
	for row := 0; row < protocol.NoteRows; row++ {
		for _, degree := range protocol.MajorPentatonic {
			if (row-root-degree)%12 == 0 {
				rows = append(rows, row)
			}
		}
	}
	return rows
}
