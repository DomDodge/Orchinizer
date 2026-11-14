package game

import (
	"time"

	"orchinizer/protocol"
)

const (
	perfectWindowMS int64 = 120
	hitWindowMS     int64 = protocol.ScoreHitWindowMS
)

// Only the room goroutine changes a score. Gestures are judged on receipt,
// before the TV quantizes audio to the next beat. No client-supplied scores or clocks.
type roundScorer struct {
	state protocol.RoundScoring
	seen  map[string]bool
	aims  []aim // the conductor's selected seat over time, for holds
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

func newRoundScorer(parts []protocol.Part, tempo int, start, end time.Time) *roundScorer {
	s := &roundScorer{state: protocol.RoundScoring{Targets: []protocol.CueTarget{}}, seen: map[string]bool{}}
	if len(parts) == 0 || tempo <= 0 {
		return s
	}
	// Equal opportunities across tempos; spread prompts over whole bars.
	// Alternate in/out independently per part, with no simultaneous targets.
	slowestTempo := tempo
	for _, kt := range roundKeys {
		slowestTempo = min(slowestTempo, kt.tempo)
	}
	available := end.Sub(start) - time.Duration(hitWindowMS)*time.Millisecond
	if available <= 0 {
		return s
	}
	maxBars := int(float64(available) * float64(tempo) / float64(4*time.Minute))
	count := int(float64(available) * float64(slowestTempo) / float64(4*time.Minute))
	if count == 0 {
		return s
	}
	window := time.Duration(hitWindowMS) * time.Millisecond
	beatDur := time.Duration(float64(time.Minute) / float64(tempo))
	var ats []time.Time
	for i := 0; i < count; i++ {
		bar := 1
		if count > 1 {
			bar += i * (maxBars - 1) / (count - 1)
		}
		at := start.Add(time.Duration(bar*4) * beatDur)
		if !at.Add(window).Before(end) {
			break
		}
		ats = append(ats, at)
	}
	playing := map[int]bool{}
	for i, at := range ats {
		part := parts[i%len(parts)]
		target := protocol.CueTarget{ID: i + 1, Kind: protocol.TargetFlick, Seat: part.Seat, At: at.UnixMilli(), Result: "pending"}
		// Every 4th prompt is a hold, if it ends before the next prompt's window opens (and before the song ends).
		holdEnd := at.Add(protocol.HoldBeats * beatDur)
		nextOpens := end
		if i+1 < len(ats) {
			nextOpens = ats[i+1].Add(-window)
		}
		if i%4 == 3 && holdEnd.Before(nextOpens) && holdEnd.Before(end) {
			target.Kind, target.End = protocol.TargetHold, holdEnd.UnixMilli()
		} else {
			target.Action = protocol.CueIn
			if playing[part.Seat] {
				target.Action = protocol.CueOut
			}
			playing[part.Seat] = !playing[part.Seat]
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

func (s *roundScorer) expire(now int64) bool {
	changed := false
	for i, target := range s.state.Targets {
		switch {
		case target.Result != "pending":
		case target.Kind == protocol.TargetHold && now > target.End:
			s.judge(i, holdResult(s.aimedShare(target.Seat, target.At, target.End)), now)
			changed = true
		case target.Kind != protocol.TargetHold && now > target.At+hitWindowMS:
			s.judge(i, "miss", now)
			changed = true
		}
	}
	return changed
}

func holdResult(share float64) string {
	switch {
	case share >= protocol.HoldPerfectShare:
		return "perfect"
	case share >= protocol.HoldGoodShare:
		return "good"
	}
	return "miss"
}

// false means a duplicate cue: do not forward or count it a second time.
func (s *roundScorer) attempt(cue protocol.Cue, now int64) bool {
	if s.seen[cue.ID] {
		return false
	}
	s.seen[cue.ID] = true
	expired := s.expire(now)
	for i, target := range s.state.Targets {
		if target.Result != "pending" || target.Kind == protocol.TargetHold {
			continue // holds are scored from aim, not cues
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
		if cue.Seat == target.Seat && cue.Action == target.Action {
			result = "good"
			if now >= target.At-perfectWindowMS && now <= target.At+perfectWindowMS {
				result = "perfect"
			}
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
		if target.Kind == protocol.TargetHold {
			s.judge(i, holdResult(s.aimedShare(target.Seat, target.At, target.End)), target.End+1)
		} else {
			s.judge(i, "miss", target.At+hitWindowMS+1)
		}
	}
	return s.state.Summary
}
