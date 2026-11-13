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
	playing := map[int]bool{}
	for i := 0; i < count; i++ {
		bar := 1
		if count > 1 {
			bar += i * (maxBars - 1) / (count - 1)
		}
		beat := bar * 4
		at := start.Add(time.Duration(float64(beat) * float64(time.Minute) / float64(tempo)))
		if !at.Add(time.Duration(hitWindowMS) * time.Millisecond).Before(end) {
			break
		}
		part := parts[len(s.state.Targets)%len(parts)]
		action := protocol.CueIn
		if playing[part.Seat] {
			action = protocol.CueOut
		}
		playing[part.Seat] = !playing[part.Seat]
		s.state.Targets = append(s.state.Targets, protocol.CueTarget{ID: len(s.state.Targets) + 1, Seat: part.Seat, Action: action, At: at.UnixMilli(), Result: "pending"})
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
		if target.Result == "pending" && now > target.At+hitWindowMS {
			s.judge(i, "miss", now)
			changed = true
		}
	}
	return changed
}

// false means a duplicate cue: do not forward or count it a second time.
func (s *roundScorer) attempt(cue protocol.Cue, now int64) bool {
	if s.seen[cue.ID] {
		return false
	}
	s.seen[cue.ID] = true
	expired := s.expire(now)
	for i, target := range s.state.Targets {
		if target.Result != "pending" {
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
		if target.Result == "pending" {
			s.judge(i, "miss", target.At+hitWindowMS+1)
		}
	}
	return s.state.Summary
}
