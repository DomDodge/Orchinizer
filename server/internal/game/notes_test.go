package game

import (
	"strings"
	"testing"

	"orchinizer/protocol"
)

func notesMsg(r *Room, c Client, notes []protocol.Note) {
	send(r, c, protocol.Pattern{Envelope: protocol.Envelope{Type: protocol.TypePattern}, Notes: notes})
}

// tryNotes sends a part and returns the error it caused, or "" if it was accepted.
func tryNotes(r *Room, c *fakeClient, notes []protocol.Note) string {
	c.msgs = nil
	notesMsg(r, c, notes)
	return c.lastError()
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
		{"notes in a row", []protocol.Note{note("a", 1, 0, 4), note("b", 1, 4+protocol.MinGapSteps, 4)}, ""},
		{"longest note", []protocol.Note{note("a", 0, 0, protocol.MaxNoteSteps)}, ""},
		{"last step of the song", []protocol.Note{note("a", 0, protocol.LoopSteps-1, 1)}, ""},
		{"chord: the song is monophonic", []protocol.Note{note("a", 0, 0, 8), note("b", 2, 0, 8)}, "clash"},
		{"back to back: notes may touch", []protocol.Note{note("a", 1, 0, 4), note("b", 3, 4, 4)}, ""},
		{"one step of overlap", []protocol.Note{note("a", 1, 0, 5), note("b", 3, 4, 4)}, "clash"},
		{"too long", []protocol.Note{note("a", 0, 0, protocol.MaxNoteSteps+1)}, "at most"},
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
		{"overlap", []protocol.Note{note("a", 3, 0, 5), note("b", 3, 4, 2)}, "clash"},
		{"out of order but apart", []protocol.Note{note("b", 0, 20, 2), note("a", 4, 0, 2)}, ""},
		{"unknown instrument", []protocol.Note{{ID: "a", Row: 0, Start: 0, Length: 1, Instrument: "kazoo"}}, "isn't in this game"},
	}
	for _, tc := range cases {
		got := validateNotes(tc.notes, allowed, nil)
		if tc.want == "" && got != "" {
			t.Errorf("%s: want valid, got %q", tc.name, got)
		}
		if tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: want error containing %q, got %q", tc.name, tc.want, got)
		}
	}
}

func TestValidateNotesAgainstTheSheet(t *testing.T) {
	sebas := []sheetNote{{Note: note("s1", 2, 16, 4), owner: "Sebas"}} // steps 16-19
	cases := []struct {
		name  string
		notes []protocol.Note
		want  string
	}{
		{"before", []protocol.Note{note("a", 0, 10, 4)}, ""}, // ends at 14
		{"after", []protocol.Note{note("a", 0, 20+protocol.MinGapSteps, 2)}, ""},
		{"same step, other row", []protocol.Note{note("a", 4, 16, 1)}, "Clashes with Sebas's note"},
		{"ends where it starts: touching is fine", []protocol.Note{note("a", 0, 12, 4)}, ""},
		{"runs into it", []protocol.Note{note("a", 0, 12, 5)}, "Clashes with Sebas's note"},
		{"starts right after: touching is fine", []protocol.Note{note("a", 0, 20, 2)}, ""},
		{"starts on its last step", []protocol.Note{note("a", 0, 19, 2)}, "Clashes with Sebas's note"},
		{"inside it", []protocol.Note{note("a", 1, 17, 1)}, "Clashes with Sebas's note"},
	}
	for _, tc := range cases {
		got := validateNotes(tc.notes, nil, sebas)
		if tc.want == "" && got != "" {
			t.Errorf("%s: want valid, got %q", tc.name, got)
		}
		if tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: want error containing %q, got %q", tc.name, tc.want, got)
		}
	}
}

func TestPlayersShareOneSheet(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "Ada") // conducts round 1
	bob := joinPlayer(r, "Bob")
	cy := joinPlayer(r, "Cy")
	host(r, tv, protocol.HostStart)

	if e := tryNotes(r, bob, []protocol.Note{note("b1", 0, 0, 4)}); e != "" {
		t.Fatalf("bob's note rejected: %s", e)
	}
	// Cy can't write over Bob's note, on any row...
	if e := tryNotes(r, cy, []protocol.Note{note("c1", 3, 2, 2)}); !strings.Contains(e, "Clashes with Bob's note") {
		t.Fatalf("want a conflict with Bob, got %q", e)
	}
	if len(r.players[3].notes) != 0 {
		t.Fatalf("rejected part was stored: %+v", r.players[3].notes)
	}
	// ...but can right after it.
	if e := tryNotes(r, cy, []protocol.Note{note("c1", 3, 4+protocol.MinGapSteps, 2)}); e != "" {
		t.Fatalf("cy's note right after bob's rejected: %s", e)
	}
	// Every phone sees the whole sheet.
	if s := bob.state(t); len(s.Notes[2]) != 1 || len(s.Notes[3]) != 1 {
		t.Fatalf("sheet in state: %+v", s.Notes)
	}
	// Bob can resize his own note freely, but not into Cy.
	if e := tryNotes(r, bob, []protocol.Note{note("b1", 0, 0, 5)}); !strings.Contains(e, "Clashes with Cy's note") {
		t.Fatalf("want a conflict with Cy, got %q", e)
	}
	if e := tryNotes(r, bob, []protocol.Note{note("b1", 0, 0, 2)}); e != "" {
		t.Fatalf("shortening bob's note rejected: %s", e)
	}
}

func TestEmptyPartsAreFilledAroundTheSheet(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "Ada") // conducts
	bob := joinPlayer(r, "Bob")
	joinPlayer(r, "Cy") // writes nothing
	host(r, tv, protocol.HostStart)
	// Bob fills most of the song: a note every 8 steps leaves 1-step holes only.
	var part []protocol.Note
	for i := 0; i < protocol.MaxNotes; i++ {
		part = append(part, note(strings.Repeat("b", i+1), 0, i*8, 7))
	}
	notesMsg(r, bob, part)
	if e := bob.lastError(); e != "" {
		t.Fatalf("bob's part rejected: %s", e)
	}
	host(r, tv, protocol.HostNext) // lock -> calibrate

	var sheet []sheetNote
	for _, p := range r.seatOrder() {
		if p.seat == r.conductor {
			continue
		}
		if len(p.notes) == 0 {
			t.Fatalf("seat %d (%s, bot=%v) has no part after lock", p.seat, p.instrument, p.bot)
		}
		if p.noteCount != len(p.notes) {
			t.Fatalf("seat %d noteCount %d != %d notes", p.seat, p.noteCount, len(p.notes))
		}
		if p.seat != 2 && len(p.notes) > autoNotes {
			t.Fatalf("seat %d got %d auto notes", p.seat, len(p.notes))
		}
		for _, n := range p.notes {
			sheet = append(sheet, sheetNote{Note: n, owner: p.name})
		}
	}
	// The filled sheet still keeps every rule.
	if e := validateNotes(nil, nil, sheet); e != "" {
		t.Fatalf("filled sheet breaks the rules: %s", e)
	}
	// Bob's 8 bars are full, so the fill landed in the other 8.
	for _, sn := range sheet {
		if sn.owner != "Bob" && sn.Start < protocol.MaxNotes*8 {
			t.Fatalf("auto note inside Bob's bars: %+v", sn)
		}
	}
}

func TestGridsAreRejectedInCompose(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	joinPlayer(r, "Ada")
	bob := joinPlayer(r, "Bob")
	var g protocol.Grid
	g[0][0] = true
	pattern(r, bob, g) // the lobby still takes grids, for testing
	if e := bob.lastError(); e != "" {
		t.Fatalf("lobby grid rejected: %s", e)
	}
	host(r, tv, protocol.HostStart)
	pattern(r, bob, g)
	var e protocol.Error
	if !bob.last(protocol.TypeError, &e) || e.Code != protocol.ErrBadPattern || !strings.Contains(e.Message, "note editor") {
		t.Fatalf("want bad_pattern for a grid in compose, got %+v", e)
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
	part := []protocol.Note{note("a", 0, 0, 4), note("b", 4, 8, 6)}
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
	if !strings.Contains(bob.lastError(), "clash") {
		t.Fatalf("want clash error, got %q", bob.lastError())
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
	// A new round starts everyone's part empty.
	if r.players[2].notes != nil || r.players[2].noteCount != 0 {
		t.Fatalf("notes not reset for round 2: %+v", r.players[2].notes)
	}
	_ = ada
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
