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
	r.scorer = nil
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
			// Bots write their part at the end of compose, into whatever space the humans left.
		}
	}
	r.pending = map[string]protocol.Cue{}
	r.lastSelect, r.lastVolume = time.Time{}, time.Time{}
	r.aimSeat = 0 // a new conductor hasn't pointed at anyone yet

	r.setDeadline(r.timings.Compose)
	r.log.Info("compose", "round", r.round, "conductor", conductor, "key", r.key, "tempo", r.tempo)
	r.broadcastState()
	r.sendPatterns()
}

func (r *Room) startCalibrate() {
	// Lock the patterns. Seats with an empty part (bots, and players who
	// wrote nothing) get notes in the sheet's free space so every seat plays.
	rng := rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64()))
	for _, p := range r.seatOrder() {
		if p.seat != r.conductor && p.noteCount == 0 && p.instrument != "" {
			p.notes = fillNotes(r.sheetExcept(p), p.instrument, autoNotes, rng)
			p.noteCount = len(p.notes)
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
	for _, p := range r.players {
		p.playing = false
	}
	r.setDeadline(r.timings.Perform)
	r.scorer = newRoundScorer(r.currentParts(), r.tempo, time.Now(), r.deadline)
	r.scorer.aimAt(r.aimSeat, time.Now().UnixMilli()) // already pointing from calibration
	r.log.Info("perform", "round", r.round)
	r.broadcastState()
}

// finishPerformance saves the round's score.
func (r *Room) finishPerformance() {
	name := ""
	if p := r.players[r.conductor]; p != nil {
		name = p.name
	}
	var score *protocol.ScoreSummary
	if r.scorer != nil {
		summary := r.scorer.finish()
		score = &summary
	}
	r.performances = append(r.performances, protocol.PerformanceSummary{
		Round: r.round, ConductorSeat: r.conductor, ConductorName: name,
		Key: r.key, Tempo: r.tempo, Score: score,
	})
	for _, p := range r.players {
		p.playing = false
	}
}

// startResults shows the scores. The most points wins; a tie goes to the
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
		points := 0
		if s.Score != nil {
			points = s.Score.Points
		}
		if points > best {
			best, r.winner = points, s.Round
		}
	}
	r.log.Info("results", "winner", r.winner, "points", best)
	r.broadcastState()
}

// toLobby resets the game, keeping the human players.
func (r *Room) toLobby() {
	r.scorer = nil
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
	r.performances, r.winner = nil, 0
	r.log.Info("lobby")
	r.broadcastState()
	r.sendPatterns()
}
