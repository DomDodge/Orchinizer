package game

import (
	"strconv"
	"time"

	"orchinizer/protocol"
)

// onMessage handles every message after join. The phase decides what's
// accepted; anything else gets a not_allowed error.
func (r *Room) onMessage(c Client, typ string, raw []byte) {
	isTV := c == r.tv
	p := r.playerByClient(c)
	if !isTV && p == nil {
		return // not joined (or replaced by a reconnect)
	}

	switch typ {
	case protocol.TypeCategories, protocol.TypePick, protocol.TypeLeave, protocol.TypeKick:
		r.lobbyMessage(c, p, typ, raw)
	case protocol.TypePattern:
		r.onPattern(c, p, raw)

	case protocol.TypeSelect, protocol.TypeCue, protocol.TypeVolume, protocol.TypeCalibrated:
		r.onConductor(c, p, typ, raw)

	case protocol.TypeCueScheduled:
		if !isTV {
			r.reject(c, "only the tv sends cue_scheduled")
			return
		}
		r.onCueScheduled(c, raw)

	case protocol.TypeBar:
		if !isTV {
			r.reject(c, "only the tv sends bar")
			return
		}
		var m protocol.Bar
		if !r.decode(c, raw, &m) {
			return
		}
		m.Envelope = r.env(protocol.TypeBar)
		r.broadcastPlayers(m)

	case protocol.TypeHostAction:
		if !isTV && (p == nil || p.seat != r.hostSeat()) {
			r.reject(c, "Only the host or TV controls the game")
			return
		}
		var m protocol.HostAction
		if !r.decode(c, raw, &m) {
			return
		}
		if !isTV && m.Action != protocol.HostStart && m.Action != protocol.HostRestart {
			r.reject(c, "Only the TV skips phases")
			return
		}
		r.onHostAction(c, m.Action)

	case protocol.TypeVote:
		if p == nil {
			r.reject(c, "only players vote")
			return
		}
		var m protocol.Vote
		if !r.decode(c, raw, &m) {
			return
		}
		r.onVote(c, p, m.Round)

	case protocol.TypeJoin:
		r.reject(c, "already joined")

	default:
		r.reject(c, "unknown message type "+typ)
	}
}

func (r *Room) onPattern(c Client, p *player, raw []byte) {
	if p == nil {
		r.reject(c, "only players send patterns")
		return
	}
	// Patterns are accepted in the lobby (so the sequencer can be tested)
	// and during compose. The conductor sits compose out.
	if r.phase != protocol.PhaseLobby && r.phase != protocol.PhaseCompose {
		r.reject(c, "patterns are locked")
		return
	}
	if r.phase == protocol.PhaseCompose && p.seat == r.conductor {
		r.reject(c, "the conductor doesn't compose")
		return
	}
	var m protocol.Pattern
	if !r.decode(c, raw, &m) {
		return
	}
	if m.Instrument != "" && m.Instrument != p.instrument {
		if r.phase != protocol.PhaseLobby {
			r.reject(c, "Your instrument is locked for this game")
			return
		}
		if err := r.setPick(p, m.Instrument); err != "" {
			r.reject(c, err)
			return
		}
	}
	if p.instrument == "" {
		r.reject(c, "Pick an instrument first")
		return
	}

	p.steps = m.Steps
	p.noteCount = countNotes(m.Steps)
	r.broadcastState()
	r.sendPatterns()
}

// onConductor validates select, cue, volume, and calibrated, then relays
// them to the TV. In the lobby (no conductor yet) any player may send them,
// so cues can be tested before a game starts.
func (r *Room) onConductor(c Client, p *player, typ string, raw []byte) {
	if p == nil {
		r.reject(c, "only the conductor sends "+typ)
		return
	}
	if r.phase != protocol.PhaseLobby { // in the lobby anyone may (dev mode)
		ok := p.seat == r.conductor && conductorAllowed(r.phase, typ)
		if !ok {
			// select and volume stream at up to 10/s, so a few always arrive
			// just after the phase or conductor changes. Drop those quietly;
			// cue and calibrated are deliberate, so they get an error.
			if typ != protocol.TypeSelect && typ != protocol.TypeVolume {
				if p.seat != r.conductor {
					r.reject(c, "only the conductor sends "+typ)
				} else {
					r.reject(c, typ+" isn't accepted during "+r.phase)
				}
			}
			return
		}
	}

	if !r.underRate(typ) {
		return // over 10/s: drop quietly, the next one will carry the latest value
	}

	var out any
	switch typ {
	case protocol.TypeSelect:
		var m protocol.Select
		if !r.decode(c, raw, &m) {
			return
		}
		if m.Seat != 0 && r.players[m.Seat] == nil {
			r.reject(c, "no such seat")
			return
		}
		m.Envelope = r.env(typ)
		out = m
	case protocol.TypeCue:
		var m protocol.Cue
		if !r.decode(c, raw, &m) {
			return
		}
		if m.ID == "" {
			r.reject(c, "Cue ID is required")
			return
		}
		if m.Action == protocol.CueAllOut && m.Seat == 0 {
			for _, q := range r.seatOrder() {
				if q.seat != r.conductor {
					cue := protocol.Cue{Envelope: r.env(typ), ID: m.ID + "-" + strconv.Itoa(q.seat), Seat: q.seat, Action: protocol.CueOut}
					r.pending[cue.ID] = cue
					r.sendTo(r.tv, cue)
				}
			}
			return
		}
		if r.players[m.Seat] == nil || m.Seat == r.conductor || !validAction(m.Action) {
			r.reject(c, "cue needs a player's seat and action in/out")
			return
		}
		m.Envelope = r.env(typ)
		r.pending[m.ID] = m
		out = m
	case protocol.TypeVolume:
		var m protocol.Volume
		if !r.decode(c, raw, &m) {
			return
		}
		if r.players[m.Seat] == nil {
			r.reject(c, "no such seat")
			return
		}
		m.Level = max(0, min(100, m.Level))
		r.players[m.Seat].level = m.Level
		r.broadcastState()
		m.Envelope = r.env(typ)
		out = m
	case protocol.TypeCalibrated:
		var m protocol.Calibrated
		if !r.decode(c, raw, &m) {
			return
		}
		m.Envelope = r.env(typ)
		out = m
	}
	// Re-encoded, so the TV only ever sees validated fields and the right room.
	r.sendTo(r.tv, out)

	if typ == protocol.TypeCalibrated && r.phase == protocol.PhaseCalibrate {
		r.log.Info("calibrated", "round", r.round)
		r.startPerform()
	}
}

func conductorAllowed(phase, typ string) bool {
	switch typ {
	case protocol.TypeSelect:
		return phase == protocol.PhaseCalibrate || phase == protocol.PhasePerform
	case protocol.TypeCalibrated:
		return phase == protocol.PhaseCalibrate
	default: // cue, volume
		return phase == protocol.PhasePerform
	}
}

func (r *Room) onCueScheduled(c Client, raw []byte) {
	if r.phase != protocol.PhasePerform && r.phase != protocol.PhaseLobby {
		return // a cue that landed after perform ended; ignore quietly
	}
	var m protocol.CueScheduled
	if !r.decode(c, raw, &m) {
		return
	}
	if r.players[m.Seat] == nil || !validAction(m.Action) {
		r.reject(c, "cue_scheduled needs an existing seat and action in/out")
		return
	}
	queued, ok := r.pending[m.ID]
	if !ok || queued.Seat != m.Seat || queued.Action != m.Action {
		return
	}
	delete(r.pending, m.ID)
	if r.phase == protocol.PhasePerform {
		r.cueLog = append(r.cueLog, protocol.LoggedCue{ID: m.ID, Seat: m.Seat, Action: m.Action, Beat: m.Beat})
	}
	r.players[m.Seat].playing = m.Action == protocol.CueIn
	r.broadcastState()
}

// minStreamInterval keeps select and volume at 10/s or less each. A little
// under 100 ms, so ordinary send jitter doesn't drop messages.
const minStreamInterval = 90 * time.Millisecond

func (r *Room) underRate(typ string) bool {
	var last *time.Time
	switch typ {
	case protocol.TypeSelect:
		last = &r.lastSelect
	case protocol.TypeVolume:
		last = &r.lastVolume
	default:
		return true
	}
	now := time.Now()
	if now.Sub(*last) < minStreamInterval {
		return false
	}
	*last = now
	return true
}
