package protocol

// Shared game constants. messages.ts mirrors these.

const (
	MinPlayers       = 4 // bots fill the empty seats up to this many
	MaxPlayers       = 8
	ScoreHitWindowMS = 300
)

// Categories are presented in this order in every lobby.
var CategoryNames = []string{"strings", "wind", "percussion", "keys"}
var InstrumentGroups = map[string][]string{
	"strings":    {"contrabass", "cello", "viola", "violin", "harp", "guitar"},
	"wind":       {"flute", "clarinet", "sax", "trumpet", "trombone", "tuba"},
	"percussion": {"drums", "timpani", "xylophone", "bongos"},
	"keys":       {"piano", "organ", "synth"},
}

// SeatColors[seat-1] is that seat's color.
var SeatColors = [MaxPlayers]string{
	"#e6194b", "#3cb44b", "#ffe119", "#4363d8",
	"#f58231", "#911eb4", "#42d4f4", "#f032e6",
}

const ScaleMajorPentatonic = "major_pentatonic"

// MajorPentatonic: semitones above the tonic. Row r of a Grid plays degree r.
var MajorPentatonic = [Rows]int{0, 2, 4, 7, 9}

// Note editor. messages.ts mirrors these.
const (
	StepsPerBeat = 4  // 16th notes
	LoopSteps    = 32 // 2 bars of 4/4; every part loops at this length
	MaxNotes     = 16 // notes per player
)

// RoomCodeAlphabet: room codes are 4 letters from this set (no I or O).
const RoomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const RoomCodeLength = 4
