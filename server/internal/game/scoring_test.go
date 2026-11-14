package game

import (
	"fmt"
	"testing"
	"time"

	"orchinizer/protocol"
)

// songParts is a song of n notes, one a second at 120 bpm (8 steps of 125 ms) from
// step 8, seats 2, 3, 4 in turn. Every 4th note is 4 steps long (a 500 ms hold).
func songParts(n int) []protocol.Part {
	parts := []protocol.Part{{Seat: 2}, {Seat: 3}, {Seat: 4}}
	for i := 0; i < n; i++ {
		length := 1
		if i%4 == 3 {
			length = protocol.HoldMinSteps
		}
		p := &parts[i%3]
		p.Notes = append(p.Notes, protocol.Note{ID: fmt.Sprint(i), Start: 8 + i*8, Length: length})
	}
	return parts
}

func scoringFixture() *roundScorer {
	start := time.UnixMilli(1_000_000)
	return newRoundScorer(songParts(30), 120, start, start.Add(45*time.Second))
}

// play hits target i perfectly: a flick on its note, and for a hold, aimed at for its whole length.
func play(s *roundScorer, i int, id string) {
	target := s.state.Targets[i]
	s.aimAt(target.Seat, target.At)
	s.attempt(protocol.Cue{ID: id, Seat: target.Seat}, target.At)
	if target.Kind == protocol.TargetHold {
		s.expire(target.End + 1)
	}
}

func TestScoreTargetsFollowTheSong(t *testing.T) {
	s := scoringFixture()
	if len(s.state.Targets) != 30 || s.state.Summary.Total != 30 {
		t.Fatalf("targets: %+v", s.state)
	}
	for i, target := range s.state.Targets {
		if target.ID != i+1 || target.Seat != 2+i%3 || target.At != 1_001_000+int64(i)*1000 || target.Result != "pending" {
			t.Fatalf("target %d: %+v", i, target)
		}
		hold := i%4 == 3
		if hold != (target.Kind == protocol.TargetHold) || (hold && target.End != target.At+500) || (!hold && target.End != 0) {
			t.Fatalf("kind %d: %+v", i, target)
		}
	}
	// Notes that can't be judged before perform ends are left off; grid-only parts have no notes.
	start := time.UnixMilli(1_000_000)
	short := newRoundScorer(songParts(30), 120, start, start.Add(5*time.Second))
	if len(short.state.Targets) != 4 {
		t.Fatalf("short perform: %d targets", len(short.state.Targets))
	}
	if len(newRoundScorer([]protocol.Part{{Seat: 2, Steps: grid("x.......")}}, 120, start, start.Add(45*time.Second)).state.Targets) != 0 {
		t.Fatal("grid part made targets")
	}
	// Notes on the same step are ordered by seat.
	same := newRoundScorer([]protocol.Part{{Seat: 3, Notes: []protocol.Note{{Start: 8, Length: 1}}}, {Seat: 2, Notes: []protocol.Note{{Start: 8, Length: 1}}}}, 120, start, start.Add(45*time.Second))
	if same.state.Targets[0].Seat != 2 || same.state.Targets[1].Seat != 3 {
		t.Fatalf("same-step order: %+v", same.state.Targets)
	}
}

func TestScoreTimingWindows(t *testing.T) {
	for _, tc := range []struct {
		offset int64
		result string
		points int
	}{
		{-301, "pending", 0}, {-300, "good", 50}, {-121, "good", 50}, {-120, "perfect", 100},
		{0, "perfect", 100}, {120, "perfect", 100}, {121, "good", 50}, {300, "good", 50}, {301, "miss", 0},
	} {
		s := scoringFixture()
		target := s.state.Targets[0]
		s.attempt(protocol.Cue{ID: "test", Seat: target.Seat}, target.At+tc.offset)
		if s.state.Targets[0].Result != tc.result || s.state.Summary.Points != tc.points {
			t.Fatalf("offset %d: %+v", tc.offset, s.state)
		}
	}
}

func TestScoreComboMissAndDuplicates(t *testing.T) {
	s := scoringFixture()
	for i := 0; i < 5; i++ {
		target := s.state.Targets[i]
		if target.Kind == protocol.TargetHold {
			play(s, i, "hold")
			continue
		}
		cue := protocol.Cue{ID: string(rune('a' + i)), Seat: target.Seat}
		if !s.attempt(cue, target.At) || s.attempt(cue, target.At) {
			t.Fatal("duplicate cue not ignored")
		}
	}
	if s.state.Summary.Points != 600 || s.state.Combo != 5 || s.state.Summary.MaxCombo != 5 {
		t.Fatalf("combo: %+v", s.state)
	}
	target := s.state.Targets[5]
	s.attempt(protocol.Cue{ID: "wrong", Seat: 99}, target.At)
	s.attempt(protocol.Cue{ID: "retry", Seat: target.Seat}, target.At)
	if s.state.Combo != 0 || s.state.Summary.Misses != 1 || s.state.Summary.Points != 600 {
		t.Fatalf("wrong seat can be retried: %+v", s.state)
	}
	target = s.state.Targets[6]
	s.attempt(protocol.Cue{ID: "recover", Seat: target.Seat}, target.At)
	if s.state.Last.Points != 100 || s.state.Combo != 1 {
		t.Fatal("combo didn't reset")
	}
	// Target 7 is a hold nobody flicked: it misses once its flick window closes.
	if !s.expire(s.state.Targets[7].At+hitWindowMS+1) || s.state.Combo != 0 || s.state.Summary.Misses != 2 {
		t.Fatal("unplayed target didn't miss")
	}
	if s.expire(s.state.Targets[7].End + 2) {
		t.Fatal("miss counted twice")
	}
	final := s.finish()
	if final.Perfect+final.Good+final.Misses != final.Total || final.Points != 700 {
		t.Fatalf("final: %+v", final)
	}
}

func TestScoreMultiplierCap(t *testing.T) {
	s := scoringFixture()
	for i := 0; i < 20; i++ {
		play(s, i, string(rune('a'+i)))
	}
	if s.state.Last.Points != 400 || s.state.Summary.MaxCombo != 20 {
		t.Fatalf("multiplier should cap at 4x: %+v", s.state.Last)
	}
}

func TestRoomScoringAuthorityPersistenceAndReset(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	conductor := joinPlayer(r, "Ada")
	player := joinPlayer(r, "Bob")
	host(r, tv, protocol.HostStart)
	r.onDeadline()
	r.onDeadline()
	if r.scorer == nil || tv.state(t).Scoring == nil {
		t.Fatal("missing scoring state")
	}
	// One flick on Bob's seat, due now (the bots' song notes are random).
	r.scorer.state.Targets = []protocol.CueTarget{{ID: 1, Kind: protocol.TargetFlick, Seat: 2, At: time.Now().UnixMilli(), Result: "pending"}}
	cue := protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "score-cue", Seat: 2}
	send(r, player, cue)
	if r.scorer.state.Summary.Points != 0 {
		t.Fatal("non-conductor scored")
	}
	send(r, conductor, cue)
	if tv.state(t).Scoring.Summary.Points != 100 {
		t.Fatal("conductor didn't score")
	}
	send(r, conductor, cue)
	if r.scorer.state.Summary.Points != 100 || r.scorer.state.Combo != 1 {
		t.Fatal("retry awarded twice")
	}
	var welcome protocol.Welcome
	conductor.last(protocol.TypeWelcome, &welcome)
	r.onLeave(conductor)
	reconnected := &fakeClient{}
	r.onJoin(reconnected, protocol.Join{Role: protocol.RolePlayer, Token: welcome.Token})
	if reconnected.state(t).Scoring.Summary.Points != 100 {
		t.Fatal("reconnect lost score")
	}
	r.onDeadline()
	if r.performances[0].Score.Points != 100 || r.scorer != nil {
		t.Fatal("score didn't persist or reset for next round")
	}
	r.onDeadline()
	r.onDeadline()
	if r.scorer.state.Summary.Points != 0 || r.scorer.state.Combo != 0 {
		t.Fatal("next conductor inherited score")
	}
	r.toLobby()
	if r.scorer != nil || tv.state(t).Scoring != nil || len(r.performances) != 0 {
		t.Fatal("restart didn't clear scoring")
	}
}

func TestScoreWinnerUsesPointsThenRound(t *testing.T) {
	r := newTestRoom()
	joinTV(r)
	joinPlayer(r, "Ada")
	joinPlayer(r, "Bob")
	r.performances = []protocol.PerformanceSummary{
		{Round: 1, ConductorSeat: 1, Score: &protocol.ScoreSummary{Points: 100}},
		{Round: 2, ConductorSeat: 2, Score: &protocol.ScoreSummary{Points: 200}},
	}
	r.startResults()
	if r.winner != 2 || r.phase != protocol.PhaseResults {
		t.Fatalf("most points didn't win: winner %d", r.winner)
	}
	r.performances[0].Score.Points = 200
	r.startResults()
	if r.winner != 1 {
		t.Fatal("earlier round didn't break a tie")
	}
}

func TestHoldNeedsTheFlickThenTheAim(t *testing.T) {
	for _, tc := range []struct {
		name   string
		flick  int64 // ms after the note, or -1 for no flick
		aim    func(s *roundScorer, seat int, at, end int64)
		result string
	}{
		{"whole hold", 0, func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at-500) }, "perfect"},
		{"late by 10%", 0, func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at+(end-at)/10) }, "perfect"},
		{"drifts off for 30%", 0, func(s *roundScorer, seat int, at, end int64) {
			s.aimAt(seat, at)
			s.aimAt(seat+1, end-(end-at)*3/10)
		}, "good"},
		{"good flick", 200, func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at-500) }, "good"},
		{"only half", 0, func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at+(end-at)/2) }, "miss"},
		{"never aimed", 0, func(s *roundScorer, seat int, at, end int64) {}, "miss"},
		{"no flick", -1, func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at-500) }, "miss"},
	} {
		s := scoringFixture()
		for i := 0; i < 3; i++ {
			play(s, i, string(rune('a'+i)))
		}
		hold := s.state.Targets[3]
		tc.aim(s, hold.Seat, hold.At, hold.End)
		if tc.flick >= 0 {
			s.attempt(protocol.Cue{ID: "hold", Seat: hold.Seat}, hold.At+tc.flick)
		}
		if s.expire(hold.End) && s.state.Targets[3].Result != "pending" && tc.flick >= 0 {
			t.Fatalf("%s: judged before the hold ended", tc.name)
		}
		s.expire(hold.End + hitWindowMS + 1)
		if got := s.state.Targets[3].Result; got != tc.result {
			t.Fatalf("%s: got %s, want %s", tc.name, got, tc.result)
		}
	}
}

func TestRoomRecordsEveryAimForHolds(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	conductor := joinPlayer(r, "Ada")
	joinPlayer(r, "Bob")
	host(r, tv, protocol.HostStart)
	r.onDeadline()
	// Pointing during calibrate carries into perform.
	send(r, conductor, protocol.Select{Envelope: protocol.Envelope{Type: protocol.TypeSelect}, Seat: 2})
	r.onDeadline()
	if len(r.scorer.aims) != 1 || r.scorer.aims[0].seat != 2 {
		t.Fatalf("perform didn't start from the calibrate aim: %+v", r.scorer.aims)
	}
	// Two selects inside the 10/s relay limit: the relay drops one, the aim log keeps both.
	send(r, conductor, protocol.Select{Envelope: protocol.Envelope{Type: protocol.TypeSelect}, Seat: 0})
	send(r, conductor, protocol.Select{Envelope: protocol.Envelope{Type: protocol.TypeSelect}, Seat: 2})
	if n := len(r.scorer.aims); n != 3 || r.scorer.aims[n-1].seat != 2 {
		t.Fatalf("rate limit lost an aim: %+v", r.scorer.aims)
	}
}
