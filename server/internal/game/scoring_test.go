package game

import (
	"testing"
	"time"

	"orchinizer/protocol"
)

func scoringFixture() *roundScorer {
	start := time.UnixMilli(1_000_000)
	return newRoundScorer([]protocol.Part{{Seat: 2}, {Seat: 3}, {Seat: 4}}, 120, start, start.Add(45*time.Second))
}

// play hits target i perfectly: a flick on the beat, or a hold aimed at for its whole length.
func play(s *roundScorer, i int, id string) {
	target := s.state.Targets[i]
	s.aimAt(target.Seat, target.At)
	if target.Kind == protocol.TargetHold {
		s.expire(target.End + 1)
		return
	}
	s.attempt(protocol.Cue{ID: id, Seat: target.Seat, Action: target.Action}, target.At)
}

func TestScoreTargets(t *testing.T) {
	s := scoringFixture()
	if len(s.state.Targets) != 15 || s.state.Summary.Total != 15 {
		t.Fatalf("targets: %+v", s.state)
	}
	playing := map[int]bool{}
	for i, target := range s.state.Targets {
		if target.ID != i+1 || target.Seat != 2+i%3 || (target.At-1_000_000)%2000 != 0 || (i > 0 && target.At <= s.state.Targets[i-1].At) {
			t.Fatalf("target %d: %+v", i, target)
		}
		if i%4 == 3 { // every 4th is a 3-beat hold (120 bpm: 1500 ms), with no cue action
			if target.Kind != protocol.TargetHold || target.End != target.At+1500 || target.Action != "" {
				t.Fatalf("hold %d: %+v", i, target)
			}
			continue
		}
		want := protocol.CueIn
		if playing[target.Seat] {
			want = protocol.CueOut
		}
		playing[target.Seat] = !playing[target.Seat]
		if target.Kind != protocol.TargetFlick || target.Action != want || target.End != 0 {
			t.Fatalf("flick %d: %+v", i, target)
		}
	}
	start := time.UnixMilli(1_000_000)
	slower := newRoundScorer([]protocol.Part{{Seat: 2}}, 84, start, start.Add(45*time.Second))
	if len(slower.state.Targets) != len(s.state.Targets) {
		t.Fatal("tempo changes scoring opportunities")
	}
	if len(newRoundScorer(nil, 120, time.Now(), time.Now()).state.Targets) != 0 {
		t.Fatal("empty orchestra has targets")
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
		s.attempt(protocol.Cue{ID: "test", Seat: target.Seat, Action: target.Action}, target.At+tc.offset)
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
			play(s, i, "")
			continue
		}
		cue := protocol.Cue{ID: string(rune('a' + i)), Seat: target.Seat, Action: target.Action}
		if !s.attempt(cue, target.At) || s.attempt(cue, target.At) {
			t.Fatal("duplicate cue not ignored")
		}
	}
	if s.state.Summary.Points != 600 || s.state.Combo != 5 || s.state.Summary.MaxCombo != 5 {
		t.Fatalf("combo: %+v", s.state)
	}
	target := s.state.Targets[5]
	s.attempt(protocol.Cue{ID: "wrong", Seat: 99, Action: target.Action}, target.At)
	s.attempt(protocol.Cue{ID: "retry", Seat: target.Seat, Action: target.Action}, target.At)
	if s.state.Combo != 0 || s.state.Summary.Misses != 1 || s.state.Summary.Points != 600 {
		t.Fatalf("wrong seat can be retried: %+v", s.state)
	}
	target = s.state.Targets[6]
	s.attempt(protocol.Cue{ID: "recover", Seat: target.Seat, Action: target.Action}, target.At)
	if s.state.Last.Points != 100 || s.state.Combo != 1 {
		t.Fatal("combo didn't reset")
	}
	// Target 7 is a hold on seat 3, but the conductor is still aimed at seat 2.
	if !s.expire(s.state.Targets[7].End+1) || s.state.Combo != 0 || s.state.Summary.Misses != 2 {
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

func TestScoreMultiplierCapAndWrongAction(t *testing.T) {
	start := time.UnixMilli(1_000_000)
	s := newRoundScorer([]protocol.Part{{Seat: 2}, {Seat: 3}, {Seat: 4}}, 120, start, start.Add(65*time.Second))
	for i := 0; i < 20; i++ {
		play(s, i, string(rune('a'+i)))
	}
	if s.state.Last.Points != 400 || s.state.Summary.MaxCombo != 20 {
		t.Fatal("multiplier should cap at 4x")
	}
	target := s.state.Targets[20]
	s.attempt(protocol.Cue{ID: "bad-action", Seat: target.Seat, Action: "all_out"}, target.At)
	if s.state.Last.Result != "miss" || s.state.Combo != 0 {
		t.Fatal("wrong action scored")
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
	r.scorer.state.Targets[0].At = time.Now().UnixMilli()
	target := r.scorer.state.Targets[0]
	cue := protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "score-cue", Seat: target.Seat, Action: target.Action}
	send(r, player, cue)
	if r.scorer.state.Summary.Points != 0 {
		t.Fatal("non-conductor scored")
	}
	send(r, conductor, cue)
	if tv.state(t).Scoring.Summary.Points != 100 {
		t.Fatal("conductor didn't score")
	}
	send(r, tv, protocol.CueScheduled{Envelope: protocol.Envelope{Type: protocol.TypeCueScheduled}, ID: cue.ID, Seat: cue.Seat, Action: cue.Action, Beat: 4})
	send(r, conductor, cue)
	if r.scorer.state.Summary.Points != 100 || r.scorer.state.Combo != 1 {
		t.Fatal("TV scheduling or retry awarded twice")
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

func TestAllOutCountsOneMissAndIgnoresRetry(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	conductor := joinPlayer(r, "Ada")
	joinPlayer(r, "Bob")
	host(r, tv, protocol.HostStart)
	r.onDeadline()
	r.onDeadline()
	r.scorer.state.Targets[0].At = time.Now().UnixMilli()
	stop := protocol.Cue{Envelope: protocol.Envelope{Type: protocol.TypeCue}, ID: "stop-all", Seat: 0, Action: protocol.CueAllOut}
	send(r, conductor, stop)
	send(r, conductor, stop)
	if r.scorer.state.Summary.Misses != 1 || r.scorer.state.Summary.Points != 0 || len(r.pending) != 3 {
		t.Fatalf("all-out: %+v, pending %d", r.scorer.state, len(r.pending))
	}
	for _, cue := range r.pending {
		send(r, tv, protocol.CueScheduled{Envelope: protocol.Envelope{Type: protocol.TypeCueScheduled}, ID: cue.ID, Seat: cue.Seat, Action: cue.Action, Beat: 4})
	}
	if r.scorer.state.Summary.Misses != 1 || r.scorer.state.Summary.Points != 0 {
		t.Fatal("expanded audio acks changed score")
	}
}

func TestHoldScoredByShareOfTimeAimed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		aim    func(s *roundScorer, seat int, at, end int64)
		result string
	}{
		{"whole hold", func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at-500) }, "perfect"},
		{"late by 10%", func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at+(end-at)/10) }, "perfect"},
		{"drifts off for 30%", func(s *roundScorer, seat int, at, end int64) {
			s.aimAt(seat, at)
			s.aimAt(seat+1, end-(end-at)*3/10)
		}, "good"},
		{"only half", func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat, at+(end-at)/2) }, "miss"},
		{"wrong player", func(s *roundScorer, seat int, at, end int64) { s.aimAt(seat+1, at) }, "miss"},
		{"never aimed", func(s *roundScorer, seat int, at, end int64) {}, "miss"},
	} {
		s := scoringFixture()
		hold := s.state.Targets[3]
		tc.aim(s, hold.Seat, hold.At, hold.End)
		if s.expire(hold.End) && s.state.Targets[3].Result != "pending" {
			t.Fatalf("%s: judged before the hold ended", tc.name)
		}
		s.expire(hold.End + 1)
		if got := s.state.Targets[3].Result; got != tc.result {
			t.Fatalf("%s: got %s, want %s", tc.name, got, tc.result)
		}
	}
}

func TestFlickDuringHoldDoesNotConsumeIt(t *testing.T) {
	s := scoringFixture()
	for i := 0; i < 3; i++ {
		play(s, i, string(rune('a'+i)))
	}
	hold := s.state.Targets[3]
	s.aimAt(hold.Seat, hold.At)
	s.attempt(protocol.Cue{ID: "oops", Seat: hold.Seat, Action: protocol.CueIn}, hold.At)
	if s.state.Targets[3].Result != "pending" || s.state.Last.Result != "early" {
		t.Fatalf("flick consumed the hold: %+v", s.state.Last)
	}
	s.expire(hold.End + 1)
	if s.state.Targets[3].Result != "perfect" {
		t.Fatal("hold still counts when aimed throughout")
	}
	final := s.finish()
	if final.Perfect+final.Good+final.Misses != final.Total {
		t.Fatalf("final: %+v", final)
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
