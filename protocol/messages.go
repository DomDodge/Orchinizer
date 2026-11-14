// Package protocol is the shared message schema for Phone Orchestra.
// messages.ts mirrors this file field for field. Change both together,
// and announce the change in the group chat.
package protocol

// Message types.
const (
	TypeCategories   = "categories"
	TypePick         = "pick"
	TypeLeave        = "leave"
	TypeKick         = "kick"
	TypeKicked       = "kicked"
	TypeJoin         = "join"          // any client -> server
	TypeWelcome      = "welcome"       // server -> the client that joined
	TypeError        = "error"         // server -> one client
	TypeState        = "state"         // server -> all
	TypePattern      = "pattern"       // player -> server
	TypePatterns     = "patterns"      // server -> tv
	TypeCalibrated   = "calibrated"    // conductor -> server -> tv
	TypeSelect       = "select"        // conductor -> server -> tv
	TypeCue          = "cue"           // conductor -> server -> tv
	TypeVolume       = "volume"        // conductor -> server -> tv
	TypeCueScheduled = "cue_scheduled" // tv -> server
	TypeBar          = "bar"           // tv -> server -> players
	TypeHostAction   = "host_action"   // tv -> server
)

// Roles. The conductor is not a role: it is the player whose seat equals
// State.Conductor this round.
const (
	RoleTV     = "tv"
	RolePlayer = "player"
)

// Phases.
const (
	PhaseLobby     = "lobby"
	PhaseCompose   = "compose"
	PhaseCalibrate = "calibrate"
	PhasePerform   = "perform"
	PhaseResults   = "results"
)

// Cue actions.
const (
	CueIn     = "in"
	CueOut    = "out"
	CueAllOut = "all_out"
)

// Host actions.
const (
	HostStart   = "start"   // lobby -> round 1 compose
	HostNext    = "next"    // end the current phase now
	HostSkip    = "skip"    // skip the remaining rounds and go to the results
	HostRestart = "restart" // back to the lobby, keeping players
)

// Error codes.
const (
	ErrBadMessage     = "bad_message"
	ErrRoomNotFound   = "room_not_found"
	ErrRoomFull       = "room_full"
	ErrGameInProgress = "game_in_progress"
	ErrNotAllowed     = "not_allowed"
	ErrBadPattern     = "bad_pattern" // a note-editor part broke a rule; the previous part stays
)

// Grid sizes. Row 0 is the lowest note of the round's scale.
const (
	Rows  = 5
	Steps = 8
)

// Grid is a pattern: Grid[row][step].
type Grid [Rows][Steps]bool

// Envelope is the part every message shares. Decode it first to read Type,
// then decode the full message.
type Envelope struct {
	Type string `json:"type"`
	Room string `json:"room,omitempty"`
}

// Join: the first message on every connection.
//   - TV with no room: creates a room. The code comes back in Welcome.
//   - Player without room hosts; with room joins. Name is required for a new seat.
//   - Token (optional): reconnect and take back your seat or TV slot.
type Join struct {
	Envelope
	Role  string `json:"role"`
	Name  string `json:"name,omitempty"`
	Token string `json:"token,omitempty"`
}

// Welcome: the reply to a join. Store the token so you can reconnect.
// For the TV, Seat is 0 and the player fields are left out. For a player,
// Instrument and Steps are their current part, so a reconnecting phone
// can restore its sequencer.
type Welcome struct {
	Envelope
	Role       string `json:"role"`
	Seat       int    `json:"seat"`
	Color      string `json:"color,omitempty"`
	Token      string `json:"token"`
	Instrument string `json:"instrument,omitempty"`
	Steps      *Grid  `json:"steps,omitempty"`
	Notes      []Note `json:"notes,omitempty"` // the note-editor part, if the phone sent one
}

// Error is sent to one client. The connection stays open unless the
// error came from the join.
type Error struct {
	Envelope
	Code    string `json:"code"`
	Message string `json:"message"`
}

// PlayerState is one seat as everyone sees it. It never includes notes.
type PlayerState struct {
	Seat       int    `json:"seat"` // 1-based
	Name       string `json:"name"`
	Color      string `json:"color"`
	Instrument string `json:"instrument"` // picked in lobby; empty while conducting
	Connected  bool   `json:"connected"`
	Bot        bool   `json:"bot"`
	NoteCount  int    `json:"noteCount"` // for the TV's compose tiles
	Playing    bool   `json:"playing"`   // part is sounding (per the TV's cue_scheduled)
}

// PerformanceSummary is one finished round and its conductor's score.
type PerformanceSummary struct {
	Round         int    `json:"round"`
	ConductorSeat int    `json:"conductorSeat"`
	ConductorName string `json:"conductorName"`
	Key           string `json:"key"`
	Tempo         int    `json:"tempo"`
	Score         int    `json:"score"`
	Perfect       int    `json:"perfect"`
	Good          int    `json:"good"`
	Miss          int    `json:"miss"`
}

// State is the full game state. It is broadcast on every change.
type State struct {
	Envelope
	Phase       string        `json:"phase"`
	Round       int           `json:"round"`       // 1-based, 0 in the lobby
	TotalRounds int           `json:"totalRounds"` // 0 in the lobby
	Conductor   int           `json:"conductor"`   // seat, 0 = none
	Deadline    int64         `json:"deadline"`    // Unix ms the phase ends, 0 = none
	ServerTime  int64         `json:"serverTime"`  // Unix ms when this state was sent
	Key         string        `json:"key"`         // tonic, e.g. "C"
	Scale       string        `json:"scale"`       // "major_pentatonic"
	Tempo       int           `json:"tempo"`       // BPM
	Instruments []string      `json:"instruments"` // this round's group, e.g. strings
	Players     []PlayerState `json:"players"`
	// Finished rounds, in round order.
	Performances []PerformanceSummary `json:"performances"`
	Host         int                  `json:"host"`
	TVConnected  bool                 `json:"tvConnected"`
	Categories   []string             `json:"categories"`
	Patterns     map[int]Grid         `json:"patterns"`
	Notes        map[int][]Note       `json:"notes,omitempty"` // note-editor parts by seat; seats without notes are left out
	Live         map[int]int          `json:"live"`
	Winner       int                  `json:"winner"` // round with the top score (ties go to the earlier round), 0 = none yet
	// This round's cue chart while performing, else empty. See Target.
	Targets []Target `json:"targets"`
}

// Grades for a Target.
const (
	GradePerfect = "perfect"
	GradeGood    = "good"
	GradeMiss    = "miss"
)

// Target is one prompt in the cue chart: cue Seat (in or out, whichever
// toggles it) on Beat. Beat 0 is when the TV starts the transport for
// perform. Grade is "" until the conductor hits it or perform ends.
type Target struct {
	Beat   int    `json:"beat"`
	Seat   int    `json:"seat"`
	Grade  string `json:"grade"`
	Points int    `json:"points"`
}

// Pattern: a player's part. Send it on every change during compose.
// A phone using the note editor sends Notes; the grid-based sequencer sends
// Steps. Each message replaces the whole part. Steps may be left out when
// sending Notes; a missing grid decodes as empty.
type Pattern struct {
	Envelope
	Instrument string `json:"instrument,omitempty"`
	Steps      Grid   `json:"steps"`
	Notes      []Note `json:"notes,omitempty"`
}

// Part is one seat's locked pattern.
type Part struct {
	Seat       int    `json:"seat"`
	Instrument string `json:"instrument"`
	Steps      Grid   `json:"steps"`
	Notes      []Note `json:"notes,omitempty"`
}

// Note is one note from the note editor. Times are in steps (StepsPerBeat
// per beat), so they follow the round's tempo.
type Note struct {
	ID         string `json:"id"`                   // unique within the part
	Row        int    `json:"row"`                  // 0 = lowest note of the scale
	Start      int    `json:"start"`                // step, 0..LoopSteps-1
	Length     int    `json:"length"`               // steps, start+length <= LoopSteps
	Instrument string `json:"instrument,omitempty"` // "" = the player's instrument
}

// Patterns goes to the TV whenever a pattern changes, and once more when
// they lock at the end of compose.
type Patterns struct {
	Envelope
	Round  int    `json:"round"`
	Key    string `json:"key"`
	Tempo  int    `json:"tempo"`
	Parts  []Part `json:"parts"`
	Locked bool   `json:"locked"`
}

// Calibrated: the conductor has finished calibration. Angles are degrees
// relative to seat 1, keyed by seat. Receiving it moves calibrate to perform.
type Calibrated struct {
	Envelope
	Angles map[int]float64 `json:"angles"`
}

// Select: the seat the conductor is pointing at. Max 10/s.
type Select struct {
	Envelope
	Seat int `json:"seat"`
}

// Cue: bring a part in or cut it. The TV plays it on the next beat.
type Cue struct {
	Envelope
	ID     string `json:"id"`
	Seat   int    `json:"seat"`
	Action string `json:"action"`
}

// Volume for one seat, 0-100. Max 10/s.
type Volume struct {
	Envelope
	Seat  int `json:"seat"`
	Level int `json:"level"`
}

// CueScheduled: the TV reports the beat it actually played a cue on.
// Beat 0 is when the TV starts the transport for perform. This is what
// sets players[].playing.
type CueScheduled struct {
	Envelope
	ID     string `json:"id"`
	Seat   int    `json:"seat"`
	Action string `json:"action"`
	Beat   int    `json:"beat"`
	// Heard is the exact (fractional) beat the cue reached the TV, before
	// it was moved to the next beat. The server scores cues with it.
	Heard float64 `json:"heard"`
}

// Bar: sent by the TV once per bar, and relayed to every phone.
type Bar struct {
	Envelope
	Bar   int `json:"bar"`
	Tempo int `json:"tempo"`
}

// HostAction: start, next, skip, or restart.
type HostAction struct {
	Envelope
	Action string `json:"action"`
}

// Config is served as JSON at GET /config (HTTP, not WebSocket). The TV
// reads it for the QR code, so the Expo URL lives in one place: the
// server's EXPO_URL environment variable.
type Config struct {
	ExpoURL string `json:"expoUrl"` // e.g. exp://abc-anonymous-8081.exp.direct; "" if not set
}

// Lobby controls. Picks are unique across all human seats, including offline ones.
type Categories struct {
	Envelope
	Categories []string `json:"categories"`
}
type Pick struct {
	Envelope
	Instrument *string `json:"instrument"`
}
type Leave struct{ Envelope }
type Kick struct {
	Envelope
	Seat int `json:"seat"`
}
type Kicked struct{ Envelope }
