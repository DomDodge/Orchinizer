package game

import (
	"strings"
	"testing"

	"orchinizer/protocol"
)

func notesMsg(r *Room, c Client, notes []protocol.Note) {
	send(r, c, protocol.Pattern{Envelope: protocol.Envelope{Type: protocol.TypePattern}, Notes: notes})
}

func note(id string, row, start, length int) protocol.Note {
	return protocol.Note{ID: id, Row: row, Start: start, Length: length}
}

func TestValidateNotes(t *testing.T) {
	allowed := []string{"violin", "cello"}
	tooMany := []protocol.Note{}
	for i := 0; i <= protocol.MaxNotes; i++ {
		tooMany = append(tooMany, note(strings.Repeat("n", i+1), i%protocol.Rows, (i/protocol.Rows)*4, 1))
	}
	cases := []struct {
		name  string
		notes []protocol.Note
		want  string // substring of the error; "" = valid
	}{
		{"empty", nil, ""},
		{"chord on different rows", []protocol.Note{note("a", 0, 0, 8), note("b", 2, 0, 8)}, ""},
		{"back to back on one row", []protocol.Note{note("a", 1, 0, 4), note("b", 1, 4, 4)}, ""},
		{"fills the whole loop", []protocol.Note{note("a", 0, 0, protocol.LoopSteps)}, ""},
		{"named instrument", []protocol.Note{{ID: "a", Row: 0, Start: 0, Length: 1, Instrument: "cello"}}, ""},
		{"too many", tooMany, "at most"},
		{"missing id", []protocol.Note{note("", 0, 0, 1)}, "bad id"},
		{"long id", []protocol.Note{note(strings.Repeat("x", maxNoteIDLen+1), 0, 0, 1)}, "bad id"},
		{"duplicate id", []protocol.Note{note("a", 0, 0, 1), note("a", 1, 0, 1)}, "used twice"},
		{"row below", []protocol.Note{note("a", -1, 0, 1)}, "off the staff"},
		{"row above", []protocol.Note{note("a", protocol.Rows, 0, 1)}, "off the staff"},
		{"negative start", []protocol.Note{note("a", 0, -1, 2)}, "doesn't fit"},
		{"zero length", []protocol.Note{note("a", 0, 0, 0)}, "doesn't fit"},
		{"past the loop", []protocol.Note{note("a", 0, protocol.LoopSteps-2, 3)}, "doesn't fit"},
		{"overlap", []protocol.Note{note("a", 3, 0, 5), note("b", 3, 4, 2)}, "overlap"},
		{"unknown instrument", []protocol.Note{{ID: "a", Row: 0, Start: 0, Length: 1, Instrument: "kazoo"}}, "isn't in this game"},
	}
	for _, tc := range cases {
		got := validateNotes(tc.notes, allowed)
		if tc.want == "" && got != "" {
			t.Errorf("%s: want valid, got %q", tc.name, got)
		}
		if tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: want error containing %q, got %q", tc.name, tc.want, got)
		}
	}
}

func TestNotesFlowThroughTheGame(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	ada := joinPlayer(r, "Ada")
	bob := joinPlayer(r, "Bob")
	host(r, tv, protocol.HostStart)
	if s := tv.state(t); s.Phase != protocol.PhaseCompose || s.Conductor != 1 {
		t.Fatalf("after start: %+v", s)
	}

	// Bob (seat 2) composes with the note editor.
	part := []protocol.Note{note("a", 0, 0, 4), note("b", 4, 8, 12)}
	notesMsg(r, bob, part)
	if e := bob.lastError(); e != "" {
		t.Fatalf("valid notes rejected: %s", e)
	}
	s := tv.state(t)
	if got := s.Notes[2]; len(got) != 2 || got[1] != part[1] {
		t.Fatalf("state.notes[2] = %+v", got)
	}
	if s.Players[1].NoteCount != 2 {
		t.Fatalf("noteCount = %d, want 2", s.Players[1].NoteCount)
	}
	if _, ok := s.Notes[1]; ok {
		t.Fatal("a seat without notes should be left out of state.notes")
	}
	var pats protocol.Patterns
	if !tv.last(protocol.TypePatterns, &pats) {
		t.Fatal("tv got no patterns")
	}
	found := false
	for _, p := range pats.Parts {
		if p.Seat == 2 {
			found = len(p.Notes) == 2
		}
	}
	if !found {
		t.Fatalf("tv parts missing bob's notes: %+v", pats.Parts)
	}

	// An invalid part is rejected and the previous one stays.
	notesMsg(r, bob, []protocol.Note{note("a", 0, 0, 4), note("b", 0, 2, 4)})
	if !strings.Contains(bob.lastError(), "overlap") {
		t.Fatalf("want overlap error, got %q", bob.lastError())
	}
	if got := r.players[2].notes; len(got) != 2 || got[1] != part[1] {
		t.Fatalf("rejected part replaced the old one: %+v", got)
	}

	// A reconnecting phone gets its notes back in welcome.
	tok := r.players[2].token
	r.handle(event{kind: evLeave, client: bob})
	bob2 := &fakeClient{}
	r.handle(event{kind: evJoin, client: bob2, join: protocol.Join{Role: protocol.RolePlayer, Name: "Bob", Token: tok, Room: r.code}})
	var w protocol.Welcome
	if !bob2.last(protocol.TypeWelcome, &w) || len(w.Notes) != 2 {
		t.Fatalf("welcome after reconnect: %+v", w)
	}

	// Calibrate locks the parts; the notes survive into the performance log.
	host(r, tv, protocol.HostNext)
	if s := tv.state(t); s.Phase != protocol.PhaseCalibrate {
		t.Fatalf("want calibrate, got %s", s.Phase)
	}
	notesMsg(r, bob2, part)
	if bob2.lastError() == "" {
		t.Fatal("notes accepted after compose ended")
	}
	host(r, tv, protocol.HostNext) // perform
	host(r, tv, protocol.HostNext) // round 2 compose (Bob conducts)
	if len(r.performances) != 1 {
		t.Fatalf("want 1 performance, got %d", len(r.performances))
	}
	for _, p := range r.performances[0].Parts {
		if p.Seat == 2 && len(p.Notes) != 2 {
			t.Fatalf("performance lost bob's notes: %+v", p)
		}
	}
	// A new round starts everyone's part empty.
	if r.players[2].notes != nil || r.players[2].noteCount != 0 {
		t.Fatalf("notes not reset for round 2: %+v", r.players[2].notes)
	}
	_ = ada
}

func TestGridPatternsStillWork(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "Ada")
	bob := joinPlayer(r, "Bob")
	host(r, tv, protocol.HostStart)
	var g protocol.Grid
	g[0][0], g[2][4] = true, true
	pattern(r, bob, g)
	if e := bob.lastError(); e != "" {
		t.Fatalf("grid pattern rejected: %s", e)
	}
	s := tv.state(t)
	if s.Players[1].NoteCount != 2 || s.Patterns[2] != g {
		t.Fatalf("grid part: noteCount=%d pattern=%v", s.Players[1].NoteCount, s.Patterns[2])
	}
	if s.Notes != nil {
		t.Fatalf("grid-only game should send no notes, got %+v", s.Notes)
	}
}

func TestBadPatternCode(t *testing.T) {
	r := newTestRoom()
	joinTV(r)
	bob := joinPlayer(r, "Bob")
	notesMsg(r, bob, []protocol.Note{note("a", 9, 0, 1)}) // lobby accepts patterns for testing
	var e protocol.Error
	if !bob.last(protocol.TypeError, &e) || e.Code != protocol.ErrBadPattern {
		t.Fatalf("want %s, got %+v", protocol.ErrBadPattern, e)
	}
}

func TestPatternBurstIsCoalescedNotDropped(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	bob := joinPlayer(r, "Bob")

	notesMsg(r, bob, []protocol.Note{note("a", 0, 0, 1)})
	before := len(tv.msgs)
	// A drag: three more changes inside one interval. They're stored, not broadcast.
	notesMsg(r, bob, []protocol.Note{note("a", 0, 0, 2)})
	notesMsg(r, bob, []protocol.Note{note("a", 0, 0, 3)})
	notesMsg(r, bob, []protocol.Note{note("a", 0, 0, 4)})
	if len(tv.msgs) != before {
		t.Fatalf("burst broadcast %d messages, want 0 until the flush", len(tv.msgs)-before)
	}
	if !r.flushPending || r.players[1].notes[0].Length != 4 {
		t.Fatalf("latest part not stored or no flush scheduled: %+v", r.players[1].notes)
	}
	// The trailing flush (posted by the timer in real use) sends the latest part.
	r.handle(event{kind: evFlush})
	if r.flushPending {
		t.Fatal("flushPending not cleared")
	}
	if got := tv.state(t).Notes[1]; len(got) != 1 || got[0].Length != 4 {
		t.Fatalf("flush sent %+v, want the length-4 note", got)
	}
}
