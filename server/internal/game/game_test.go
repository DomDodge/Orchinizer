package game

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"orchinizer/protocol"
)

// fakeClient records everything the room sends it.
type fakeClient struct {
	msgs   [][]byte
	closed bool
}

func (f *fakeClient) Send(b []byte) bool { f.msgs = append(f.msgs, b); return true }
func (f *fakeClient) Close()             { f.closed = true }

// last decodes the most recent message of type typ into v; false if none.
func (f *fakeClient) last(typ string, v any) bool {
	for i := len(f.msgs) - 1; i >= 0; i-- {
		var e protocol.Envelope
		json.Unmarshal(f.msgs[i], &e)
		if e.Type == typ {
			json.Unmarshal(f.msgs[i], v)
			return true
		}
	}
	return false
}

func (f *fakeClient) state(t *testing.T) protocol.State {
	t.Helper()
	var s protocol.State
	if !f.last(protocol.TypeState, &s) {
		t.Fatal("no state received")
	}
	return s
}

func (f *fakeClient) lastError() string {
	var e protocol.Error
	if f.last(protocol.TypeError, &e) {
		return e.Message
	}
	return ""
}

// The room is driven synchronously: handle() and onDeadline() run on the
// test goroutine, the same way run() would call them.
func newTestRoom() *Room {
	return newRoom("TEST", nil, slog.New(slog.NewTextHandler(io.Discard, nil)), DefaultTimings)
}

func send(r *Room, c Client, v any) {
	b, _ := json.Marshal(v)
	var e protocol.Envelope
	json.Unmarshal(b, &e)
	r.handle(event{kind: evMessage, client: c, typ: e.Type, raw: b})
}

func joinTV(r *Room) *fakeClient {
	c := &fakeClient{}
	r.handle(event{kind: evJoin, client: c, join: protocol.Join{Role: protocol.RoleTV}})
	return c
}

func joinPlayer(r *Room, name string) *fakeClient {
	c := &fakeClient{}
	r.handle(event{kind: evJoin, client: c, join: protocol.Join{Role: protocol.RolePlayer, Name: name}})
	for _, inst := range r.instruments() {
		if r.setPick(r.playerByClient(c), inst) == "" {
			break
		}
	}
	r.broadcastState()
	return c
}

func host(r *Room, tv Client, action string) {
	send(r, tv, protocol.HostAction{Envelope: protocol.Envelope{Type: protocol.TypeHostAction}, Action: action})
}

func pattern(r *Room, c Client, g protocol.Grid) {
	send(r, c, protocol.Pattern{Envelope: protocol.Envelope{Type: protocol.TypePattern}, Steps: g})
}

func TestFullGame(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	ada := joinPlayer(r, "Ada")
	bob := joinPlayer(r, "Bob")

	host(r, tv, protocol.HostStart)
	s := tv.state(t)
	// 2 humans + 2 bots; each human conducts once.
	if s.Phase != protocol.PhaseCompose || s.Round != 1 || s.TotalRounds != 2 || s.Conductor != 1 {
		t.Fatalf("after start: %+v", s)
	}
	if len(s.Players) != 4 || !s.Players[2].Bot || !s.Players[3].Bot {
		t.Fatalf("bots not filled: %+v", s.Players)
	}
	if s.Deadline == 0 || s.Key == "" || s.Tempo == 0 {
		t.Fatalf("missing deadline/key/tempo: %+v", s)
	}
	for _, p := range s.Players[1:] {
		if p.Instrument == "" {
			t.Fatalf("seat %d has no instrument", p.Seat)
		}
	}

	// The conductor can't compose; Bob can. Bob leaves his pattern empty.
	pattern(r, ada, grid("x......."))
	if ada.lastError() != "the conductor doesn't compose" {
		t.Fatalf("conductor composed: %q", ada.lastError())
	}
	// Ada can't cue during compose.
	send(r, ada, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "x", Seat: 2, Action: "in"})
	if ada.lastError() == "" {
		t.Fatal("cue accepted during compose")
	}

	// Compose ends: patterns lock, Bob's empty pattern gets the default.
	r.onDeadline()
	var pats protocol.Patterns
	tv.last(protocol.TypePatterns, &pats)
	if !pats.Locked || len(pats.Parts) != 3 {
		t.Fatalf("patterns at lock: %+v", pats)
	}
	if countNotes(pats.Parts[0].Steps) == 0 {
		t.Fatal("empty pattern didn't get a default")
	}
	if tv.state(t).Phase != protocol.PhaseCalibrate {
		t.Fatal("not calibrating")
	}
	pattern(r, bob, grid("x......."))
	if bob.lastError() != "patterns are locked" {
		t.Fatalf("pattern after lock: %q", bob.lastError())
	}

	// Only the conductor may calibrate; calibrated moves straight to perform.
	send(r, bob, protocol.Calibrated{Envelope: protocol.Envelope{Type: protocol.TypeCalibrated}})
	if bob.lastError() == "" {
		t.Fatal("non-conductor calibrated")
	}
	send(r, ada, protocol.Calibrated{Envelope: protocol.Envelope{Type: protocol.TypeCalibrated}, Angles: map[int]float64{2: 0, 3: 25}})
	if tv.state(t).Phase != protocol.PhasePerform {
		t.Fatal("calibrated didn't start perform")
	}
	var cal protocol.Calibrated
	if !tv.last(protocol.TypeCalibrated, &cal) || cal.Angles[3] != 25 {
		t.Fatalf("tv didn't get calibrated: %+v", cal)
	}

	// Perform: cue goes to the TV, the TV's cue_scheduled is logged.
	send(r, ada, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "c1", Seat: 2, Action: "in"})
	var cue protocol.Cue
	if !tv.last(protocol.TypeCue, &cue) || cue.Seat != 2 {
		t.Fatalf("tv didn't get cue: %+v", cue)
	}
	send(r, tv, protocol.CueScheduled{Envelope: protocol.Envelope{Type: protocol.TypeCueScheduled}, ID: "c1", Seat: 2, Action: "in", Beat: 4})
	if !bob.state(t).Players[1].Playing {
		t.Fatal("bob not playing after cue_scheduled")
	}
	// Bob can't cue: he's not conducting.
	send(r, bob, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "c2", Seat: 3, Action: "in"})
	if bob.lastError() == "" {
		t.Fatal("non-conductor cue accepted")
	}

	// Scoring: a cue heard on a target's beat (plus the usual latency) is perfect.
	s = tv.state(t)
	if len(s.Targets) == 0 || s.Targets[0].Beat != chartLeadIn || s.Targets[0].Seat == 1 {
		t.Fatalf("targets: %+v", s.Targets)
	}
	tg, nTargets := s.Targets[0], len(s.Targets)
	send(r, ada, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "c3", Seat: tg.Seat, Action: "in"})
	heard := float64(tg.Beat) + protocol.CueLatencyMs*float64(s.Tempo)/60000
	send(r, tv, protocol.CueScheduled{Envelope: protocol.Envelope{Type: protocol.TypeCueScheduled}, ID: "c3", Seat: tg.Seat, Action: "in", Beat: tg.Beat + 1, Heard: heard})
	if g := tv.state(t).Targets[0]; g.Grade != protocol.GradePerfect || g.Points != protocol.PerfectPoints {
		t.Fatalf("target after a perfect cue: %+v", g)
	}

	// Perform ends -> round 2, Bob conducts, key may change, playing resets.
	r.onDeadline()
	s = tv.state(t)
	if s.Phase != protocol.PhaseCompose || s.Round != 2 || s.Conductor != 2 {
		t.Fatalf("round 2: %+v", s)
	}
	if s.Players[1].Playing || s.Players[1].Instrument != "" || s.Players[0].Instrument == "" {
		t.Fatalf("round 2 seats: %+v", s.Players)
	}
	pattern(r, ada, grid("x.x.x.x.", "", "", "", ""))
	r.onDeadline() // compose -> calibrate
	r.onDeadline() // calibrate times out -> perform
	if tv.state(t).Phase != protocol.PhasePerform {
		t.Fatal("calibrate timeout didn't start perform")
	}
	r.onDeadline() // perform -> results (every player has conducted)

	s = tv.state(t)
	if s.Phase != protocol.PhaseResults || len(s.Performances) != 2 || len(s.Targets) != 0 {
		t.Fatalf("results: %+v", s)
	}
	p1, p2 := s.Performances[0], s.Performances[1]
	if p1.ConductorName != "Ada" || p1.Score != protocol.PerfectPoints || p1.Perfect != 1 || p1.Miss != nTargets-1 {
		t.Fatalf("round 1 score: %+v", p1)
	}
	if p2.Score != 0 || p2.Perfect+p2.Good != 0 || s.Winner != 1 {
		t.Fatalf("round 2 score / winner: %+v winner %d", p2, s.Winner)
	}

	// next from results -> lobby, bots removed, humans kept.
	host(r, tv, protocol.HostNext)
	s = tv.state(t)
	if s.Phase != protocol.PhaseLobby || len(s.Players) != 2 || s.Round != 0 || s.Winner != 0 {
		t.Fatalf("back to lobby: %+v", s)
	}
}

func TestDisconnectedConductorIsSkippedAndStartDropsLeavers(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	a := joinPlayer(r, "A")
	b := joinPlayer(r, "B")
	c := joinPlayer(r, "C")
	_ = a
	// C leaves the lobby before start: their seat is dropped at start.
	r.handle(event{kind: evLeave, client: c})
	host(r, tv, protocol.HostStart)
	s := tv.state(t)
	if s.TotalRounds != 2 {
		t.Fatalf("total rounds %d, want 2", s.TotalRounds)
	}
	for _, p := range s.Players {
		if p.Name == "C" {
			t.Fatal("C still seated")
		}
	}
	// B drops mid-game; when round 2 comes, B's round is skipped -> results.
	r.handle(event{kind: evLeave, client: b})
	r.onDeadline() // compose -> calibrate
	r.onDeadline() // calibrate -> perform
	r.onDeadline() // perform -> (B skipped) -> results
	s = tv.state(t)
	if s.Phase != protocol.PhaseResults || len(s.Performances) != 1 || s.Winner != 1 {
		t.Fatalf("expected results with 1 performance: %+v", s)
	}
}

func TestSkipAndRestart(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "A")
	joinPlayer(r, "B")
	joinPlayer(r, "C")
	host(r, tv, protocol.HostStart)
	r.onDeadline() // compose -> calibrate
	r.onDeadline() // calibrate -> perform
	host(r, tv, protocol.HostSkip)
	s := tv.state(t)
	if s.Phase != protocol.PhaseResults || len(s.Performances) != 1 {
		t.Fatalf("skip during perform: %+v", s)
	}
	host(r, tv, protocol.HostRestart)
	if tv.state(t).Phase != protocol.PhaseLobby {
		t.Fatal("restart didn't go to the lobby")
	}
	// Skip during round 1 compose: no performances -> straight back to lobby.
	host(r, tv, protocol.HostStart)
	host(r, tv, protocol.HostSkip)
	if tv.state(t).Phase != protocol.PhaseLobby {
		t.Fatal("skip with no performances should return to the lobby")
	}
	// Players can't send host actions; the lobby rejects next.
	p := joinPlayer(r, "D")
	host(r, p, protocol.HostStart)
	if p.lastError() == "" {
		t.Fatal("player sent host_action")
	}
	host(r, tv, protocol.HostNext)
	if tv.lastError() == "" {
		t.Fatal("next accepted in the lobby")
	}
}

func TestTVReconnectCatchesUp(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "A")
	joinPlayer(r, "B")
	host(r, tv, protocol.HostStart)
	r.onDeadline()
	r.handle(event{kind: evLeave, client: tv})

	tv2 := &fakeClient{}
	r.handle(event{kind: evJoin, client: tv2, join: protocol.Join{Role: protocol.RoleTV}})
	var pats protocol.Patterns
	if !tv2.last(protocol.TypePatterns, &pats) || !pats.Locked {
		t.Fatalf("reconnected tv didn't get locked patterns: %+v", pats)
	}
	if tv2.state(t).Phase != protocol.PhaseCalibrate {
		t.Fatal("reconnected tv didn't get state")
	}
}

func TestSelectRateLimit(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	a := joinPlayer(r, "A")
	joinPlayer(r, "B")
	for range 5 { // a burst in the lobby (dev mode): only the first gets through
		send(r, a, protocol.Select{Envelope: protocol.Envelope{Type: protocol.TypeSelect}, Seat: 2})
	}
	n := 0
	for _, m := range tv.msgs {
		var e protocol.Envelope
		json.Unmarshal(m, &e)
		if e.Type == protocol.TypeSelect {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("tv got %d selects from a burst, want 1", n)
	}
	// Cues aren't rate limited.
	send(r, a, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "1", Seat: 2, Action: "in"})
	send(r, a, protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "2", Seat: 2, Action: "out"})
	var cue protocol.Cue
	if !tv.last(protocol.TypeCue, &cue) || cue.ID != "2" {
		t.Fatalf("second cue dropped: %+v", cue)
	}
}

func TestScoreCueWindows(t *testing.T) {
	r := newTestRoom()
	r.tempo = 100 // 600 ms per beat
	at := func(ms float64) float64 { return 8 + (ms+protocol.CueLatencyMs)/600 }
	cases := []struct {
		seat  int
		heard float64
		grade string
	}{
		{2, at(0), protocol.GradePerfect},
		{2, at(-140), protocol.GradePerfect},
		{2, at(200), protocol.GradeGood},
		{2, at(-340), protocol.GradeGood},
		{2, at(400), ""},   // too late
		{3, at(0), ""},     // wrong seat
		{2, at(-1000), ""}, // way early
	}
	for _, c := range cases {
		r.targets = []protocol.Target{{Beat: 8, Seat: 2}}
		r.scoreCue(c.seat, c.heard)
		if g := r.targets[0].Grade; g != c.grade {
			t.Errorf("seat %d heard %.3f: grade %q, want %q", c.seat, c.heard, g, c.grade)
		}
	}
	// A graded target isn't graded again; the next one on the seat is used.
	r.targets = []protocol.Target{{Beat: 8, Seat: 2, Grade: protocol.GradeGood, Points: protocol.GoodPoints}, {Beat: 9, Seat: 2}}
	r.scoreCue(2, at(0)+1)
	if r.targets[0].Points != protocol.GoodPoints || r.targets[1].Grade != protocol.GradePerfect {
		t.Fatalf("regraded: %+v", r.targets)
	}
}

func TestChart(t *testing.T) {
	r := newTestRoom()
	r.tempo, r.conductor = 120, 1
	for seat := 1; seat <= 4; seat++ {
		r.players[seat] = &player{seat: seat, joined: seat}
	}
	ts := r.chart()
	// 45 s at 120 BPM = 90 beats; prompts on 8, 12, ... 84.
	if len(ts) != 20 || ts[0].Beat != 8 || ts[len(ts)-1].Beat != 84 {
		t.Fatalf("chart beats: %+v", ts)
	}
	for i, tg := range ts {
		if tg.Seat == 1 || tg.Seat < 1 || tg.Seat > 4 || (i > 0 && tg.Seat == ts[i-1].Seat) {
			t.Fatalf("bad seat at %d: %+v", i, ts)
		}
	}
}

func TestMaxRounds(t *testing.T) {
	r := newTestRoom()
	r.timings.MaxRounds = 2
	tv := joinTV(r)
	joinPlayer(r, "A")
	joinPlayer(r, "B")
	joinPlayer(r, "C")
	host(r, tv, protocol.HostStart)
	if s := tv.state(t); s.TotalRounds != 2 || s.Conductor != 1 {
		t.Fatalf("start: %+v", s)
	}
	for range 3 { // round 1: compose, calibrate, perform
		r.onDeadline()
	}
	if s := tv.state(t); s.Round != 2 || s.Conductor != 2 {
		t.Fatalf("round 2: round %d conductor %d", s.Round, s.Conductor)
	}
	for range 3 {
		r.onDeadline()
	}
	if s := tv.state(t); s.Phase != protocol.PhaseResults || len(s.Performances) != 2 {
		t.Fatalf("expected results after 2 rounds: %+v", s.Phase)
	}
}
