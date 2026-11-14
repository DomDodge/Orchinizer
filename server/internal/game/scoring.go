package game

import (
	"sort"
	"time"

	"orchinizer/protocol"
)

const (
	perfectWindowMS int64 = 120
	hitWindowMS     int64 = protocol.ScoreHitWindowMS
)

// Only the room goroutine changes a score. Gestures are judged on receipt.
// No client-supplied scores or clocks.
type roundScorer struct {
	state   protocol.RoundScoring
	seen    map[string]bool
	aims    []aim          // the conductor's selected seat over time, for holds
	started map[int]string // hold index -> the grade of the flick that started it
}

type aim struct {
	at   int64
	seat int
}

// aimAt records what the conductor points at. Only changes matter.
func (s *roundScorer) aimAt(seat int, now int64) {
	if n := len(s.aims); n == 0 || s.aims[n-1].seat != seat {
		s.aims = append(s.aims, aim{now, seat})
	}
}

// aimedShare is the share of [from, to] spent aiming at seat.
func (s *roundScorer) aimedShare(seat int, from, to int64) float64 {
	if to <= from {
		return 0
	}
	var on int64
	for i, a := range s.aims {
		next := int64(1<<62 - 1)
		if i+1 < len(s.aims) {
			next = s.aims[i+1].at
		}
		if a.seat == seat {
			on += max(0, min(next, to)-max(a.at, from))
		}
	}
	return float64(on) / float64(to-from)
}

// newRoundScorer makes the chart: every note of the song, in order, as a
// prompt on its seat. Notes HoldMinSteps or longer are holds. Notes that
// can't be judged before perform ends are left off.
func newRoundScorer(parts []protocol.Part, tempo int, start, end time.Time) *roundScorer {
	s := &roundScorer{
		state:   protocol.RoundScoring{Start: start.UnixMilli(), Targets: []protocol.CueTarget{}},
		seen:    map[string]bool{},
		started: map[int]string{},
	}
	if tempo <= 0 {
		return s
	}
	type note struct{ seat, start, length int }
	var notes []note
	for _, p := range parts {
		for _, n := range p.Notes {
			notes = append(notes, note{p.Seat, n.Start, n.Length})
		}
	}
	sort.Slice(notes, func(i, j int) bool {
		if notes[i].start != notes[j].start {
			return notes[i].start < notes[j].start
		}
		return notes[i].seat < notes[j].seat
	})
	stepDur := time.Duration(float64(time.Minute) / float64(tempo*protocol.StepsPerBeat))
	window := time.Duration(hitWindowMS) * time.Millisecond
	for _, n := range notes {
		at := start.Add(time.Duration(n.start) * stepDur)
		if !at.Add(window).Before(end) {
			break // sorted, so every later note is too late as well
		}
		target := protocol.CueTarget{ID: len(s.state.Targets) + 1, Kind: protocol.TargetFlick, Seat: n.seat, At: at.UnixMilli(), Result: "pending"}
		if n.length >= protocol.HoldMinSteps {
			target.Kind = protocol.TargetHold
			target.End = min(at.Add(time.Duration(n.length)*stepDur).UnixMilli(), end.UnixMilli())
		}
		s.state.Targets = append(s.state.Targets, target)
	}
	s.state.Summary.Total = len(s.state.Targets)
	return s
}

func (s *roundScorer) judge(index int, result string, at int64) {
	target := &s.state.Targets[index]
	target.Result = result
	points := 0
	if result == "miss" {
		s.state.Combo = 0
		s.state.Summary.Misses++
	} else {
		s.state.Combo++
		s.state.Summary.MaxCombo = max(s.state.Summary.MaxCombo, s.state.Combo)
		base := 50
		if result == "perfect" {
			base = 100
			s.state.Summary.Perfect++
		} else {
			s.state.Summary.Good++
		}
		points = base * min(4, 1+s.state.Combo/5)
		s.state.Summary.Points += points
	}
	s.state.Last = &protocol.ScoreJudgment{TargetID: target.ID, Result: result, Points: points, At: at}
}

// expire misses flicks (and holds nobody started) whose window has passed,
// and scores started holds that have ended.
func (s *roundScorer) expire(now int64) bool {
	changed := false
	for i, target := range s.state.Targets {
		if target.Result != "pending" {
			continue
		}
		flick, started := s.started[i]
		switch {
		case started && now > target.End:
			s.judge(i, holdResult(flick, s.aimedShare(target.Seat, target.At, target.End)), now)
			changed = true
		case !started && now > target.At+hitWindowMS:
			s.judge(i, "miss", now)
			changed = true
		}
	}
	return changed
}

var gradeRank = map[string]int{"miss": 0, "good": 1, "perfect": 2}

// holdResult is the worse of the starting flick and the aim over the hold.
func holdResult(flick string, share float64) string {
	aim := "miss"
	switch {
	case share >= protocol.HoldPerfectShare:
		aim = "perfect"
	case share >= protocol.HoldGoodShare:
		aim = "good"
	}
	if gradeRank[flick] < gradeRank[aim] {
		return flick
	}
	return aim
}

// attempt judges a cue against the next note still waiting for a flick.
// false means a duplicate cue: do not forward or count it a second time.
func (s *roundScorer) attempt(cue protocol.Cue, now int64) bool {
	if s.seen[cue.ID] {
		return false
	}
	s.seen[cue.ID] = true
	expired := s.expire(now)
	for i, target := range s.state.Targets {
		if _, started := s.started[i]; target.Result != "pending" || started {
			continue
		}
		if now < target.At-hitWindowMS {
			// Keep the late prompt's Miss feedback.
			if expired {
				return true
			}
			s.state.Combo = 0
			s.state.Last = &protocol.ScoreJudgment{TargetID: target.ID, Result: "early", At: now}
			return true
		}
		result := "miss"
		if cue.Seat == target.Seat {
			result = "good"
			if now >= target.At-perfectWindowMS && now <= target.At+perfectWindowMS {
				result = "perfect"
			}
		}
		if target.Kind == protocol.TargetHold && result != "miss" {
			s.started[i] = result // scored when the hold ends
			return true
		}
		s.judge(i, result, now)
		return true
	}
	return true
}

func (s *roundScorer) finish() protocol.ScoreSummary {
	for i, target := range s.state.Targets {
		if target.Result != "pending" {
			continue
		}
		if flick, started := s.started[i]; started {
			s.judge(i, holdResult(flick, s.aimedShare(target.Seat, target.At, target.End)), target.End+1)
		} else {
			s.judge(i, "miss", target.At+hitWindowMS+1)
		}
	}
	return s.state.Summary
}
