package game

import (
	"fmt"

	"orchinizer/protocol"
)

// maxNoteIDLen keeps a phone from stuffing large strings into note ids.
const maxNoteIDLen = 32

// validateNotes checks a note-editor part. It returns "" if the part is
// valid, or a message for the player saying which rule it broke.
// allowed is the instruments a note may name (this game's enabled sections).
func validateNotes(notes []protocol.Note, allowed []string) string {
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
		case n.Row < 0 || n.Row >= protocol.Rows:
			return fmt.Sprintf("note %q is off the staff", n.ID)
		case n.Start < 0 || n.Length < 1 || n.Start+n.Length > protocol.LoopSteps:
			return fmt.Sprintf("note %q doesn't fit in the loop", n.ID)
		case n.Instrument != "" && !contains(allowed, n.Instrument):
			return fmt.Sprintf("note %q uses an instrument that isn't in this game", n.ID)
		}
		ids[n.ID] = true
	}
	// Two notes on the same row can't overlap. Chords (different rows) are fine.
	for i, a := range notes {
		for _, b := range notes[i+1:] {
			if a.Row == b.Row && a.Start < b.Start+b.Length && b.Start < a.Start+a.Length {
				return fmt.Sprintf("notes %q and %q overlap", a.ID, b.ID)
			}
		}
	}
	return ""
}
