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

func TestScoreTargets(t *testing.T) {
	s := scoringFixture()
	if len(s.state.Targets) != 15 || s.state.Summary.Total != 15 {
		t.Fatalf("targets: %+v", s.state)
	}
	for i, target := range s.state.Targets {
		if target.ID != i+1 || target.Seat != 2+i%3 || (target.At-1_000_000)%2000 != 0 || (i > 0 && target.At <= s.state.Targets[i-1].At) {
			t.Fatalf("target %d: %+v", i, target)
		}
		want := protocol.CueIn
		if (i/3)%2 == 1 {
			want = protocol.CueOut
		}
		if target.Action != want {
			t.Fatalf("action %d: %s", i, target.Action)
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
	if !s.expire(s.state.Targets[7].At+301) || s.state.Combo != 0 || s.state.Summary.Misses != 2 {
		t.Fatal("unplayed target didn't miss")
	}
	if s.expire(s.state.Targets[7].At + 302) {
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
		target := s.state.Targets[i]
		s.attempt(protocol.Cue{ID: string(rune('a' + i)), Seat: target.Seat, Action: target.Action}, target.At)
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

func TestScoreWinnerUsesPointsThenVotesThenRound(t *testing.T) {
	r := newTestRoom()
	joinTV(r)
	joinPlayer(r, "Ada")
	joinPlayer(r, "Bob")
	r.performances = []protocol.Performance{
		{Round: 1, ConductorSeat: 1, Score: &protocol.ScoreSummary{Points: 100}},
		{Round: 2, ConductorSeat: 2, Score: &protocol.ScoreSummary{Points: 200}},
	}
	r.players[1].vote = 1
	r.players[2].vote = 1
	r.startResults()
	if r.winner != 2 {
		t.Fatal("votes beat points")
	}
	r.performances[0].Score.Points = 200
	r.startResults()
	if r.winner != 1 {
		t.Fatal("votes didn't break tied points")
	}
	r.players[1].vote = 2
	r.startResults()
	if r.winner != 1 {
		t.Fatal("earlier round didn't break full tie")
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
