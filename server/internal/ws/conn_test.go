package ws

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"orchinizer/protocol"
	"orchinizer/server/internal/game"
)

type client struct {
	t  *testing.T
	ws *websocket.Conn
}

func dial(t *testing.T, url string) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return &client{t, c}
}

func (c *client) send(v any) {
	c.t.Helper()
	b, _ := json.Marshal(v)
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// expect reads until a message of type typ arrives and decodes it into v.
func (c *client) expect(typ string, v any) {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		_, b, err := c.ws.Read(ctx)
		if err != nil {
			c.t.Fatalf("waiting for %s: %v", typ, err)
		}
		var env protocol.Envelope
		json.Unmarshal(b, &env)
		if env.Type == typ {
			if v != nil {
				json.Unmarshal(b, v)
			}
			return
		}
	}
}

func setup(t *testing.T) string {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(Handler(game.NewRegistry(log), log))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func TestRelayFlow(t *testing.T) {
	url := setup(t)

	tv := dial(t, url)
	tv.send(protocol.Join{Envelope: protocol.Envelope{Type: "join"}, Role: "tv"})
	var tw protocol.Welcome
	tv.expect("welcome", &tw)
	room := tw.Room
	if len(room) != 4 {
		t.Fatalf("room code %q", room)
	}

	join := func(name string) (*client, protocol.Welcome) {
		c := dial(t, url)
		c.send(protocol.Join{Envelope: protocol.Envelope{Type: "join", Room: room}, Role: "player", Name: name})
		var w protocol.Welcome
		c.expect("welcome", &w)
		return c, w
	}
	ada, aw := join("Ada")
	bob, bw := join("Bob")
	if aw.Seat != 1 || bw.Seat != 2 || aw.Color != protocol.SeatColors[0] {
		t.Fatalf("seats %+v %+v", aw, bw)
	}

	// Pattern -> TV gets patterns, everyone sees noteCount.
	var g protocol.Grid
	g[0][0], g[2][4] = true, true
	bob.send(protocol.Pattern{Envelope: protocol.Envelope{Type: "pattern"}, Instrument: "violin", Steps: g})
	var pats protocol.Patterns
	for {
		tv.expect("patterns", &pats)
		if len(pats.Parts) == 2 && pats.Parts[1].Steps == g {
			break
		}
	}
	if pats.Parts[1].Instrument != "violin" {
		t.Fatalf("instrument %q", pats.Parts[1].Instrument)
	}

	// Cue (no conductor set yet, so any player may cue) -> TV.
	ada.send(protocol.Cue{Envelope: protocol.Envelope{Type: "cue"}, ID: "c1", Seat: 2, Action: "in"})
	var cue protocol.Cue
	tv.expect("cue", &cue)
	if cue.Seat != 2 || cue.Action != "in" || cue.Room != room {
		t.Fatalf("cue %+v", cue)
	}

	// cue_scheduled from the TV marks the part as playing.
	tv.send(protocol.CueScheduled{Envelope: protocol.Envelope{Type: "cue_scheduled"}, ID: "c1", Seat: 2, Action: "in", Beat: 4})
	var st protocol.State
	for {
		bob.expect("state", &st)
		if len(st.Players) == 2 && st.Players[1].Playing {
			break
		}
	}

	// Bar from the TV -> players.
	tv.send(protocol.Bar{Envelope: protocol.Envelope{Type: "bar"}, Bar: 3, Tempo: 100})
	var bar protocol.Bar
	ada.expect("bar", &bar)
	if bar.Bar != 3 {
		t.Fatalf("bar %+v", bar)
	}

	// Players can't send TV-only messages.
	ada.send(protocol.Bar{Envelope: protocol.Envelope{Type: "bar"}, Bar: 1})
	var e protocol.Error
	ada.expect("error", &e)
	if e.Code != protocol.ErrNotAllowed {
		t.Fatalf("error %+v", e)
	}
}

func TestReconnectAndErrors(t *testing.T) {
	url := setup(t)
	tv := dial(t, url)
	tv.send(protocol.Join{Envelope: protocol.Envelope{Type: "join"}, Role: "tv"})
	var tw protocol.Welcome
	tv.expect("welcome", &tw)

	// Unknown room.
	x := dial(t, url)
	x.send(protocol.Join{Envelope: protocol.Envelope{Type: "join", Room: "ZZZZ"}, Role: "player", Name: "X"})
	var e protocol.Error
	x.expect("error", &e)
	if e.Code != protocol.ErrRoomNotFound {
		t.Fatalf("error %+v", e)
	}

	// Message before join.
	y := dial(t, url)
	y.send(protocol.Vote{Envelope: protocol.Envelope{Type: "vote"}, Round: 1})
	y.expect("error", &e)
	if e.Code != protocol.ErrBadMessage {
		t.Fatalf("error %+v", e)
	}

	// Reconnect with the token from a second socket: same seat, old socket closed.
	a := dial(t, url)
	a.send(protocol.Join{Envelope: protocol.Envelope{Type: "join", Room: tw.Room}, Role: "player", Name: "Ada"})
	var w1 protocol.Welcome
	a.expect("welcome", &w1)

	a2 := dial(t, url)
	a2.send(protocol.Join{Envelope: protocol.Envelope{Type: "join", Room: tw.Room}, Role: "player", Token: w1.Token})
	var w2 protocol.Welcome
	a2.expect("welcome", &w2)
	if w2.Seat != w1.Seat || w2.Token != w1.Token {
		t.Fatalf("reconnect %+v vs %+v", w2, w1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		if _, _, err := a.ws.Read(ctx); err != nil {
			break // old socket was closed by the server
		}
	}
}
