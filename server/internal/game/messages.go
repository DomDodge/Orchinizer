package game

import (
	"encoding/json"
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
	if m.Steps != (protocol.Grid{}) && r.phase == protocol.PhaseCompose {
		// Everyone writes on the shared sheet; a grid would loop over it.
		r.sendTo(c, protocol.Error{Envelope: r.env(protocol.TypeError), Code: protocol.ErrBadPattern, Message: "Use the note editor: grid patterns aren't part of the shared song"})
		return
	}
	if err := validateNotes(m.Notes, r.instruments(), r.sheetExcept(p)); err != "" {
		// The previous part stays.
		r.sendTo(c, protocol.Error{Envelope: r.env(protocol.TypeError), Code: protocol.ErrBadPattern, Message: err})
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
	p.notes = m.Notes
	p.noteCount = countNotes(m.Steps) + len(m.Notes)
	r.patternChanged(p)
}

// patternChanged broadcasts a new part, at most once per minStreamInterval
// per player. A pattern is always stored right away; when a burst arrives
// (a phone dragging a note), the broadcast for the latest one is sent by a
// trailing flush, so no edit is lost.
func (r *Room) patternChanged(p *player) {
	now := time.Now()
	if now.Sub(p.lastPattern) >= minStreamInterval {
		p.lastPattern = now
		r.broadcastState()
		r.sendPatterns()
		return
	}
	if !r.flushPending {
		r.flushPending = true
		time.AfterFunc(minStreamInterval, func() { r.post(event{kind: evFlush}) })
	}
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

	if typ == protocol.TypeSelect {
		// Holds are scored from aim, so record every select, even ones the 10/s relay limit drops below.
		var m protocol.Select
		if json.Unmarshal(raw, &m) == nil && (m.Seat == 0 || r.players[m.Seat] != nil) { // bad ones get rejected below
			r.aimSeat = m.Seat
			if r.phase == protocol.PhasePerform && r.scorer != nil {
				r.scorer.aimAt(m.Seat, time.Now().UnixMilli())
			}
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
		if r.players[m.Seat] == nil || m.Seat == r.conductor {
			r.reject(c, "cue needs a player's seat")
			return
		}
		if !r.scoreCue(m) {
			return
		}
		m.Envelope = r.env(typ)
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

func (r *Room) scoreCue(cue protocol.Cue) bool {
	if r.phase != protocol.PhasePerform || r.scorer == nil {
		return true
	}
	if !r.scorer.attempt(cue, time.Now().UnixMilli()) {
		return false
	}
	r.broadcastState()
	return true
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
