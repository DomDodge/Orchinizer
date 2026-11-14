package game

import (
	"fmt"
	"math"
	"math/rand/v2"
	"time"

	"orchinizer/protocol"
)

// Timings are the phase lengths. Calibrate is a cap: it normally ends as
// soon as the conductor's phone sends calibrated.
type Timings struct {
	Compose, Calibrate, Perform time.Duration
	// MaxRounds caps the rounds in a game (0 = one per player). The first
	// MaxRounds players in join order conduct. For the demo, e.g. 2.
	MaxRounds int
}

var DefaultTimings = Timings{
	Compose:   180 * time.Second,
	Calibrate: 30 * time.Second,
	Perform:   45 * time.Second,
}

// The cue chart: the first prompt after a two-bar lead-in, then one every
// chartGap beats, stopping a bar before perform ends.
const (
	chartLeadIn = 8
	chartGap    = 4
)

type keyTempo struct {
	key   string
	tempo int
}

// roundKeys: each game shuffles these and plays one per round.
var roundKeys = []keyTempo{
	{"C", 96}, {"G", 104}, {"F", 88}, {"D", 112},
	{"A", 100}, {"E", 92}, {"Bb", 108}, {"Eb", 84},
}

// ---- timers ----

func (r *Room) setDeadline(d time.Duration) {
	r.stopTimer()
	r.deadline = time.Now().Add(d)
	r.timer = time.NewTimer(d)
}

func (r *Room) stopTimer() {
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	r.deadline = time.Time{}
}

// onDeadline ends the current phase when its timer fires.
func (r *Room) onDeadline() {
	r.deadline = time.Time{}
	r.advance()
}

// advance ends the current phase and starts the next one.
func (r *Room) advance() {
	switch r.phase {
	case protocol.PhaseCompose:
		r.startCalibrate()
	case protocol.PhaseCalibrate:
		r.log.Info("calibrate timed out or skipped", "round", r.round)
		r.startPerform()
	case protocol.PhasePerform:
		r.finishPerformance()
		r.nextRound()
	case protocol.PhaseResults:
		r.toLobby()
	}
}

// ---- host actions ----

func (r *Room) onHostAction(c Client, action string) {
	switch action {
	case protocol.HostStart:
		if r.phase != protocol.PhaseLobby {
			r.reject(c, "the game has already started")
			return
		}
		if err := r.startGame(); err != nil {
			r.reject(c, err.Error())
		}
	case protocol.HostNext:
		if r.phase == protocol.PhaseLobby {
			r.reject(c, "use start to begin the game")
			return
		}
		r.stopTimer()
		r.advance()
	case protocol.HostSkip:
		switch r.phase {
		case protocol.PhaseCompose, protocol.PhaseCalibrate, protocol.PhasePerform:
			r.stopTimer()
			if r.phase == protocol.PhasePerform {
				r.finishPerformance()
			}
			r.log.Info("host skipped to the results", "round", r.round)
			r.startResults()
		default:
			r.reject(c, "nothing to skip during "+r.phase)
		}
	case protocol.HostRestart:
		r.toLobby()
	default:
		r.reject(c, "unknown host action "+action)
	}
}

// ---- game flow ----

// startGame drops seats that left the lobby, fills up to MinPlayers with
// bots, fixes the conductor order (every real player, in seat order), and
// starts round 1.
func (r *Room) startGame() error {
	if r.tv == nil {
		return fmt.Errorf("Connect the TV screen before starting")
	}
	for _, p := range r.players {
		if !p.bot && p.connected() && p.pick == "" {
			return fmt.Errorf("%s needs to pick an instrument", p.name)
		}
	}
	if len(r.instruments()) < protocol.MinPlayers-1 {
		return fmt.Errorf("Enable more instruments before starting")
	}

	for seat, p := range r.players {
		if !p.connected() {
			delete(r.players, seat)
		}
	}
	r.order = nil
	for _, p := range r.seatOrder() {
		if !p.bot {
			r.order = append(r.order, p.seat)
		}
	}
	if len(r.order) == 0 {
		return fmt.Errorf("need at least one player to start")
	}
	if r.timings.MaxRounds > 0 && len(r.order) > r.timings.MaxRounds {
		r.order = r.order[:r.timings.MaxRounds]
	}
	for n := 1; len(r.players) < protocol.MinPlayers; n++ {
		seat := r.freeSeat()
		r.sequence++
		r.players[seat] = &player{
			seat:   seat,
			joined: r.sequence,
			level:  80,
			name:   fmt.Sprintf("Bot %d", n),
			color:  protocol.SeatColors[seat-1],
			token:  newToken(),
			bot:    true,
		}
	}
	r.keys = make([]keyTempo, len(roundKeys))
	copy(r.keys, roundKeys)
	rand.Shuffle(len(r.keys), func(i, j int) { r.keys[i], r.keys[j] = r.keys[j], r.keys[i] })
	r.performances = nil
	r.winner = 0
	r.round = 0
	r.log.Info("game started", "players", len(r.order), "seats", len(r.players))
	r.nextRound()
	return nil
}

// nextRound starts the next round whose conductor is connected, or the
// results when every player has had a turn.
func (r *Room) nextRound() {
	for r.round < len(r.order) {
		r.round++
		seat := r.order[r.round-1]
		if p := r.players[seat]; p != nil && p.connected() {
			r.startCompose(seat)
			return
		}
		r.log.Info("conductor not connected, skipping their round", "round", r.round, "seat", seat)
	}
	r.startResults()
}

func (r *Room) startCompose(conductor int) {
	r.phase = protocol.PhaseCompose
	r.conductor = conductor
	r.locked = false
	kt := r.keys[(r.round-1)%len(r.keys)]
	r.key, r.tempo = kt.key, kt.tempo

	// Human picks persist. Bots fill unclaimed active instruments each round.
	used := map[string]bool{}
	for _, p := range r.seatOrder() {
		p.playing, p.level = false, 80
		p.steps, p.noteCount = protocol.Grid{}, 0
		p.notes = nil
		if !p.bot {
			p.instrument = p.pick
			if p.seat == conductor {
				p.instrument = ""
			} else {
				used[p.instrument] = true
			}
		}
	}
	for _, p := range r.seatOrder() {
		if p.bot {
			for _, inst := range r.instruments() {
				if !used[inst] {
					p.instrument = inst
					used[inst] = true
					break
				}
			}
			p.steps = botPattern(p.instrument)
			p.noteCount = countNotes(p.steps)
		}
	}
	r.pending = map[string]protocol.Cue{}
	r.lastSelect, r.lastVolume = time.Time{}, time.Time{}

	r.setDeadline(r.timings.Compose)
	r.log.Info("compose", "round", r.round, "conductor", conductor, "key", r.key, "tempo", r.tempo)
	r.broadcastState()
	r.sendPatterns()
}

func (r *Room) startCalibrate() {
	// Lock the patterns. An empty pattern gets a default so every seat plays.
	for _, p := range r.seatOrder() {
		if p.seat != r.conductor && p.noteCount == 0 {
			p.steps = defaultPattern(p.instrument)
			p.noteCount = countNotes(p.steps)
		}
	}
	r.locked = true
	r.phase = protocol.PhaseCalibrate
	r.setDeadline(r.timings.Calibrate)
	r.log.Info("calibrate", "round", r.round)
	r.broadcastState()
	r.sendPatterns()
}

func (r *Room) startPerform() {
	r.phase = protocol.PhasePerform
	r.targets = r.chart()
	for _, p := range r.players {
		p.playing = false
	}
	r.setDeadline(r.timings.Perform)
	r.log.Info("perform", "round", r.round, "targets", len(r.targets))
	r.broadcastState()
}

// finishPerformance grades the targets nobody hit as misses and saves the
// round's score.
func (r *Room) finishPerformance() {
	name := ""
	if p := r.players[r.conductor]; p != nil {
		name = p.name
	}
	sum := protocol.PerformanceSummary{
		Round: r.round, ConductorSeat: r.conductor, ConductorName: name,
		Key: r.key, Tempo: r.tempo,
	}
	for _, t := range r.targets {
		switch t.Grade {
		case protocol.GradePerfect:
			sum.Perfect++
		case protocol.GradeGood:
			sum.Good++
		default:
			sum.Miss++
		}
		sum.Score += t.Points
	}
	r.performances = append(r.performances, sum)
	r.log.Info("performance scored", "round", r.round, "score", sum.Score, "perfect", sum.Perfect, "good", sum.Good, "miss", sum.Miss)
	r.targets = nil
	for _, p := range r.players {
		p.playing = false
	}
}

// startResults shows the scores. The top score wins; a tie goes to the
// earlier round. With no finished rounds it goes back to the lobby.
func (r *Room) startResults() {
	r.stopTimer()
	r.conductor = 0
	if len(r.performances) == 0 {
		r.log.Info("no performances to score")
		r.toLobby()
		return
	}
	r.phase = protocol.PhaseResults
	r.winner = 0
	best := -1
	for _, s := range r.performances { // in round order, so ties go to the earlier round
		if s.Score > best {
			best, r.winner = s.Score, s.Round
		}
	}
	r.log.Info("results", "winner", r.winner, "score", best)
	r.broadcastState()
}

// toLobby resets the game, keeping the human players.
func (r *Room) toLobby() {
	r.stopTimer()
	for seat, p := range r.players {
		if p.bot {
			delete(r.players, seat)
			continue
		}
		p.playing = false
		p.steps, p.noteCount = protocol.Grid{}, 0
		p.notes = nil
		p.instrument = p.pick
		p.level = 80
	}
	r.phase = protocol.PhaseLobby
	r.pending = map[string]protocol.Cue{}
	r.round, r.conductor, r.order = 0, 0, nil
	r.locked = false
	r.key, r.tempo = "C", 100
	r.targets, r.performances, r.winner = nil, nil, 0
	r.log.Info("lobby")
	r.broadcastState()
	r.sendPatterns()
}

// ---- scoring ----

// chart builds the round's cue prompts on random band seats, never the same
// seat twice in a row.
func (r *Room) chart() []protocol.Target {
	var band []int
	for _, p := range r.seatOrder() {
		if p.seat != r.conductor {
			band = append(band, p.seat)
		}
	}
	out := []protocol.Target{}
	if len(band) == 0 {
		return out
	}
	last := int(r.timings.Perform.Minutes()*float64(r.tempo)) - 4
	prev := 0
	for beat := chartLeadIn; beat <= last; beat += chartGap {
		seat := band[rand.IntN(len(band))]
		for seat == prev && len(band) > 1 {
			seat = band[rand.IntN(len(band))]
		}
		out = append(out, protocol.Target{Beat: beat, Seat: seat})
		prev = seat
	}
	return out
}

// scoreCue grades the closest open target on seat that a cue heard on beat
// `heard` falls within the good window of. Cues that hit nothing score nothing.
func (r *Room) scoreCue(seat int, heard float64) {
	msPerBeat := 60000 / float64(r.tempo)
	best, bestOff := -1, math.Inf(1)
	for i, t := range r.targets {
		if t.Seat != seat || t.Grade != "" {
			continue
		}
		off := math.Abs((heard-float64(t.Beat))*msPerBeat - protocol.CueLatencyMs)
		if off <= protocol.GoodWindowMs && off < bestOff {
			best, bestOff = i, off
		}
	}
	if best < 0 {
		return
	}
	t := &r.targets[best]
	if bestOff <= protocol.PerfectWindowMs {
		t.Grade, t.Points = protocol.GradePerfect, protocol.PerfectPoints
	} else {
		t.Grade, t.Points = protocol.GradeGood, protocol.GoodPoints
	}
	r.log.Info("cue scored", "round", r.round, "seat", seat, "beat", t.Beat, "offMs", int(bestOff), "grade", t.Grade)
}

// ---- preset patterns ----

// grid builds a pattern from 5 strings, lowest row first: x = note.
func grid(rows ...string) protocol.Grid {
	var g protocol.Grid
	for r, row := range rows {
		for s, ch := range row {
			g[r][s] = ch == 'x'
		}
	}
	return g
}

var presets = map[string][]protocol.Grid{
	"contrabass": {
		grid("x...x...", "........", "........", "..x...x.", "........"),
		grid("x..x..x.", "........", "........", "....x...", "........"),
	},
	"cello": {
		grid("x.......", "..x.....", "....x...", "......x.", "........"),
		grid("x...x...", "........", "..x...x.", "........", "........"),
	},
	"viola": {
		grid("........", "x.x.....", "....x.x.", "........", "........"),
		grid("........", "........", "x..x..x.", "........", ".x......"),
	},
	"violin": {
		grid("........", "........", "x.......", "..x...x.", "....x..."),
		grid("........", "........", "........", "x.x.x...", "......xx"),
	},
}

// defaultPattern is what an empty pattern becomes at lock time.
func defaultPattern(instrument string) protocol.Grid {
	if ps := presets[instrument]; len(ps) > 0 {
		return ps[0]
	}
	if instrument == "drums" || instrument == "timpani" || instrument == "bongos" {
		return grid("x...x...", "..x...x.", "x.x.x.x.")
	}
	return grid("x...x...", "..x...x.", "....x...", "......x.", "........")
}

// botPattern is a random preset for the instrument.
func botPattern(instrument string) protocol.Grid {
	if ps := presets[instrument]; len(ps) > 0 {
		return ps[rand.IntN(len(ps))]
	}
	return defaultPattern(instrument)
}
