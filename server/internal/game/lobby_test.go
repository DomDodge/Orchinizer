package game

import (
	"orchinizer/protocol"
	"testing"
)

func lobbyPlayer(r *Room, name string) *fakeClient {
	c := &fakeClient{}
	r.onJoin(c, protocol.Join{Role: protocol.RolePlayer, Name: name})
	return c
}
func pick(r *Room, c Client, instrument string) {
	send(r, c, protocol.Pick{Envelope: protocol.Envelope{Type: protocol.TypePick}, Instrument: &instrument})
}
func TestLobbyChoicesAndRemoval(t *testing.T) {
	r := newTestRoom()
	a := lobbyPlayer(r, "Ana")
	b := lobbyPlayer(r, "Ben")
	c := lobbyPlayer(r, "Cat")
	if s := a.state(t); s.Host != 1 || s.Conductor != 1 || len(s.Categories) != 3 {
		t.Fatalf("lobby: %+v", s)
	}
	pick(r, b, "violin")
	pick(r, c, "violin")
	if c.lastError() == "" || r.players[3].instrument != "" {
		t.Fatal("duplicate pick accepted")
	}
	send(r, b, protocol.Categories{Envelope: protocol.Envelope{Type: protocol.TypeCategories}, Categories: []string{"wind"}})
	if len(r.categories) != 3 {
		t.Fatal("non-host changed categories")
	}
	send(r, a, protocol.Categories{Envelope: protocol.Envelope{Type: protocol.TypeCategories}, Categories: []string{"wind", "keys"}})
	if r.players[2].instrument != "" {
		t.Fatal("disabled instrument wasn't cleared")
	}
	pick(r, c, "piano")
	r.onLeave(c)
	send(r, b, protocol.Kick{Envelope: protocol.Envelope{Type: protocol.TypeKick}, Seat: 3})
	if r.players[3] == nil {
		t.Fatal("non-host kicked")
	}
	send(r, a, protocol.Kick{Envelope: protocol.Envelope{Type: protocol.TypeKick}, Seat: 3})
	if r.players[3] != nil {
		t.Fatal("offline seat remains")
	}
	pick(r, b, "piano")
	if r.players[2].instrument != "piano" {
		t.Fatal("removed pick wasn't freed")
	}
	send(r, a, protocol.Leave{Envelope: protocol.Envelope{Type: protocol.TypeLeave}})
	d := lobbyPlayer(r, "Dan")
	if s := d.state(t); s.Host != 2 || s.Conductor != 2 || s.Players[0].Name != "Ben" || s.Players[1].Seat != 1 {
		t.Fatalf("host/join order: %+v", s)
	}
	send(r, b, protocol.Kick{Envelope: protocol.Envelope{Type: protocol.TypeKick}, Seat: 1})
	var kicked protocol.Kicked
	if !d.closed || !d.last(protocol.TypeKicked, &kicked) {
		t.Fatal("online player wasn't notified and closed")
	}
}
func TestPhoneStartPreservesPicksAndRequiresTV(t *testing.T) {
	r := newTestRoom()
	a := lobbyPlayer(r, "Ana")
	b := lobbyPlayer(r, "Ben")
	pick(r, a, "piano")
	pick(r, b, "cello")
	host(r, a, protocol.HostStart)
	if r.phase != protocol.PhaseLobby {
		t.Fatal("started without audio TV")
	}
	joinTV(r)
	host(r, b, protocol.HostStart)
	if r.phase != protocol.PhaseLobby {
		t.Fatal("non-host started")
	}
	host(r, a, protocol.HostStart)
	if r.phase != protocol.PhaseCompose || r.players[2].instrument != "cello" || r.players[1].instrument != "" {
		t.Fatal("start didn't preserve parts")
	}
	r.onDeadline()
	r.onDeadline()
	r.onDeadline()
	if r.conductor != 2 || r.players[1].instrument != "piano" {
		t.Fatal("rotation lost the host's instrument")
	}
	host(r, a, protocol.HostRestart)
	if r.players[1].instrument != "piano" || r.players[2].instrument != "cello" {
		t.Fatal("restart lost lobby picks")
	}
}

func TestStartValidationAndLockedLobby(t *testing.T) {
	r := newTestRoom()
	tv := joinTV(r)
	a := lobbyPlayer(r, "Ana")
	b := lobbyPlayer(r, "Ben")
	pick(r, a, "piano")
	host(r, a, protocol.HostStart)
	if r.phase != protocol.PhaseLobby {
		t.Fatal("started with an unpicked human")
	}
	pick(r, b, "cello")
	send(r, b, protocol.Pick{Envelope: protocol.Envelope{Type: protocol.TypePick}})
	if r.players[2].pick != "" {
		t.Fatal("null didn't unpick")
	}
	pick(r, b, "cello")
	host(r, a, protocol.HostStart)
	send(r, a, protocol.Kick{Envelope: protocol.Envelope{Type: protocol.TypeKick}, Seat: 2})
	if r.players[2] == nil {
		t.Fatal("kick accepted during game")
	}
	pick(r, b, "flute")
	if r.players[2].instrument != "cello" {
		t.Fatal("pick changed during game")
	}
	send(r, b, protocol.Pattern{Envelope: protocol.Envelope{Type: protocol.TypePattern}, Instrument: "flute"})
	if r.players[2].instrument != "cello" {
		t.Fatal("pattern bypassed instrument lock")
	}
	r.onLeave(tv)
	if a.state(t).TVConnected {
		t.Fatal("TV drop wasn't broadcast")
	}
}
