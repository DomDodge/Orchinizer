package protocol

// Shared game constants. messages.ts mirrors these.

const (
	MinPlayers       = 4 // bots fill the empty seats up to this many
	MaxPlayers       = 8
	ScoreHitWindowMS = 300
	// A hold scores Perfect when aimed at the player for this share of it, Good for HoldGoodShare.
	HoldPerfectShare = 0.9
	HoldGoodShare    = 0.6
	// A note this many steps (16ths) or longer is a hold; shorter ones are flicks.
	HoldMinSteps = 4
)

// Categories are presented in this order in every lobby.
var CategoryNames = []string{"strings", "wind", "keys"}
var InstrumentGroups = map[string][]string{
	"strings": {"contrabass", "cello", "viola", "violin", "guitar"},
	"wind":    {"flute", "clarinet", "sax", "trumpet", "trombone", "tuba"},
	"keys":    {"piano", "organ", "synth"},
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
//
// Everyone composes on one shared sheet, the song: LoopSteps long, played
// (and looped) from the top in perform. The song is monophonic: no two
// notes, from any players, overlap. Notes may touch: MinGapSteps of rest
// (currently none) separate one note's end from the next one's start.
const (
	StepsPerBeat = 4   // 16th notes
	LoopSteps    = 256 // 16 bars of 4/4: the shared song
	MaxNotes     = 16  // notes per player
	MaxNoteSteps = 8   // longest note: half a bar
	MinGapSteps  = 0   // rest required between notes: none, notes may touch
)

// RoomCodeAlphabet: room codes are 4 letters from this set (no I or O).
const RoomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const RoomCodeLength = 4
