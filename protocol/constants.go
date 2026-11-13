package protocol

// Shared game constants. messages.ts mirrors these.

const (
	MinPlayers = 4 // bots fill the empty seats up to this many
	MaxPlayers = 8
)

// InstrumentGroups: each round is dealt from one group. Strings is the
// only group for now.
var InstrumentGroups = map[string][]string{
	"strings": {"contrabass", "cello", "viola", "violin"},
}

// SeatColors[seat-1] is that seat's color.
var SeatColors = [MaxPlayers]string{
	"#e6194b", "#3cb44b", "#ffe119", "#4363d8",
	"#f58231", "#911eb4", "#42d4f4", "#f032e6",
}

const ScaleMajorPentatonic = "major_pentatonic"

// MajorPentatonic: semitones above the tonic. Row r of a Grid plays degree r.
var MajorPentatonic = [Rows]int{0, 2, 4, 7, 9}

// RoomCodeAlphabet: room codes are 4 letters from this set (no I or O).
const RoomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const RoomCodeLength = 4
