package game

import "orchinizer/protocol"

func (r *Room) hostSeat() int {
	for _, p := range r.seatOrder() {
		if !p.bot {
			return p.seat
		}
	}
	return 0
}
func (r *Room) instruments() []string {
	out := []string{}
	for _, c := range r.categories {
		out = append(out, protocol.InstrumentGroups[c]...)
	}
	return out
}
func (r *Room) setPick(p *player, instrument string) string {
	if instrument != "" {
		if !contains(r.instruments(), instrument) {
			return "Choose an instrument from the enabled sections"
		}
		for _, other := range r.players {
			if other != p && other.pick == instrument {
				return other.name + " already picked that instrument"
			}
		}
	}
	p.pick, p.instrument = instrument, instrument
	p.steps, p.noteCount = protocol.Grid{}, 0
	return ""
}
func (r *Room) lobbyMessage(c Client, p *player, typ string, raw []byte) {
	if p == nil || r.phase != protocol.PhaseLobby {
		r.reject(c, "Lobby controls are only available to players in the lobby")
		return
	}
	switch typ {
	case protocol.TypeCategories:
		if p.seat != r.hostSeat() {
			r.reject(c, "Only the host picks sections")
			return
		}
		var m protocol.Categories
		if !r.decode(c, raw, &m) {
			return
		}
		cats := []string{}
		for _, known := range protocol.CategoryNames {
			if contains(m.Categories, known) {
				cats = append(cats, known)
			}
		}
		if len(cats) == 0 {
			r.reject(c, "Pick at least one section")
			return
		}
		r.categories = cats
		for _, q := range r.players {
			if q.pick != "" && !contains(r.instruments(), q.pick) {
				r.setPick(q, "")
			}
		}
	case protocol.TypePick:
		var m protocol.Pick
		if !r.decode(c, raw, &m) {
			return
		}
		inst := ""
		if m.Instrument != nil {
			inst = *m.Instrument
		}
		if err := r.setPick(p, inst); err != "" {
			r.reject(c, err)
			return
		}
	case protocol.TypeKick:
		if p.seat != r.hostSeat() {
			r.reject(c, "Only the host removes players")
			return
		}
		var m protocol.Kick
		if !r.decode(c, raw, &m) {
			return
		}
		target := r.players[m.Seat]
		if target == nil || target == p {
			r.reject(c, "Choose another player to remove")
			return
		}
		delete(r.players, target.seat)
		if target.client != nil {
			r.sendTo(target.client, protocol.Kicked{Envelope: r.env(protocol.TypeKicked)})
			target.client.Close()
		}
	case protocol.TypeLeave:
		delete(r.players, p.seat)
		c.Close()
	}
	r.broadcastState()
	r.sendPatterns()
}
