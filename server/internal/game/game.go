package game

import (
	"fmt"
	"math/rand/v2"
	"time"

	"orchinizer/protocol"
)

// Timings are the phase lengths. Calibrate is a cap: it normally ends as
// soon as the conductor's phone sends calibrated.
type Timings struct {
	Compose, Calibrate, Perform, Vote time.Duration
	// ReplayClip is how long the TV replays each performance during the vote.
	// The vote lasts at least one clip per performance (plus a short pad), and
	// everyone voting early doesn't cut the replays off.
	ReplayClip time.Duration
}

var DefaultTimings = Timings{
	Compose:   180 * time.Second,
	Calibrate: 30 * time.Second,
	Perform:   45 * time.Second,
	Vote:      30 * time.Second,

	ReplayClip: 10 * time.Second,
}

// replayPad is extra vote time after the last replay, to tap a vote.
const replayPad = 5 * time.Second

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
	case protocol.PhaseVote:
		r.startResults()
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
			r.log.Info("host skipped to the vote", "round", r.round)
			r.startVote()
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
// vote when every player has had a turn.
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
	r.startVote()
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
	r.cueLog = nil
	for _, p := range r.players {
		p.playing = false
	}
	r.setDeadline(r.timings.Perform)
	r.log.Info("perform", "round", r.round)
	r.broadcastState()
}

// finishPerformance saves the round for replays and the vote.
func (r *Room) finishPerformance() {
	name := ""
	if p := r.players[r.conductor]; p != nil {
		name = p.name
	}
	r.performances = append(r.performances, protocol.Performance{
		Round: r.round, ConductorSeat: r.conductor, ConductorName: name,
		Key: r.key, Tempo: r.tempo,
		Parts: r.currentParts(),
		Cues:  append([]protocol.LoggedCue{}, r.cueLog...),
	})
	r.cueLog = nil
	for _, p := range r.players {
		p.playing = false
	}
}

func (r *Room) startVote() {
	r.conductor = 0
	if len(r.performances) == 0 {
		r.log.Info("no performances to vote on")
		r.toLobby()
		return
	}
	r.phase = protocol.PhaseVote
	for _, p := range r.players {
		p.vote = 0
	}
	r.voteMinEnd = time.Time{}
	d := r.timings.Vote
	if r.timings.ReplayClip > 0 {
		replays := time.Duration(len(r.performances))*r.timings.ReplayClip + replayPad
		r.voteMinEnd = time.Now().Add(replays)
		d = max(d, replays)
	}
	r.setDeadline(d)
	r.log.Info("vote", "performances", len(r.performances))
	r.broadcastState()
	r.sendPerformances()
	r.maybeEndVote() // nobody may be able to vote (e.g. one player)
}

func (r *Room) onVote(c Client, p *player, round int) {
	if r.phase != protocol.PhaseVote {
		r.reject(c, "voting isn't open")
		return
	}
	perf := r.performance(round)
	if perf == nil {
		r.reject(c, "no performance for that round")
		return
	}
	if perf.ConductorSeat == p.seat {
		r.reject(c, "you can't vote for a performance you conducted")
		return
	}
	p.vote = round // changing your vote is fine; the last one counts
	r.broadcastState()
	r.maybeEndVote()
}

// maybeEndVote ends the vote early once every connected player who can
// vote has voted.
func (r *Room) maybeEndVote() {
	if r.phase != protocol.PhaseVote {
		return
	}
	for _, p := range r.players {
		if p.bot || p.client == nil || p.vote != 0 {
			continue
		}
		for _, perf := range r.performances {
			if perf.ConductorSeat != p.seat {
				return // p can still vote
			}
		}
	}
	// Everyone has voted. Finish now, unless the TV is still replaying: then
	// pull the deadline in to the end of the replays.
	if wait := time.Until(r.voteMinEnd); wait > 0 {
		if r.deadline.Sub(r.voteMinEnd) > time.Second {
			r.setDeadline(wait)
			r.broadcastState()
		}
		return
	}
	r.stopTimer()
	r.startResults()
}

func (r *Room) startResults() {
	r.stopTimer()
	r.phase = protocol.PhaseResults
	r.winner = 0
	best := -1
	for _, s := range r.summaries() { // in round order, so ties go to the earlier round
		if s.Votes > best {
			best, r.winner = s.Votes, s.Round
		}
	}
	r.log.Info("results", "winner", r.winner, "votes", best)
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
		p.vote, p.playing = 0, false
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
	r.cueLog, r.performances, r.winner = nil, nil, 0
	r.log.Info("lobby")
	r.broadcastState()
	r.sendPatterns()
}

func (r *Room) summaries() []protocol.PerformanceSummary {
	out := make([]protocol.PerformanceSummary, 0, len(r.performances))
	for _, perf := range r.performances {
		votes := 0
		for _, p := range r.players {
			if p.vote == perf.Round {
				votes++
			}
		}
		out = append(out, protocol.PerformanceSummary{
			Round: perf.Round, ConductorSeat: perf.ConductorSeat,
			ConductorName: perf.ConductorName, Key: perf.Key, Tempo: perf.Tempo, Votes: votes,
		})
	}
	return out
}

func (r *Room) performance(round int) *protocol.Performance {
	for i := range r.performances {
		if r.performances[i].Round == round {
			return &r.performances[i]
		}
	}
	return nil
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
