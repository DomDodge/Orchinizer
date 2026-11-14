// Package ws turns WebSocket connections into game.Clients: one read
// goroutine, one write goroutine, and a buffered send queue per connection.
package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"orchinizer/protocol"
	"orchinizer/server/internal/game"
)

const (
	sendBuffer   = 64
	writeTimeout = 5 * time.Second
	pingEvery    = 20 * time.Second // under typical proxy idle timeouts
	readLimit    = 16 << 10
)

type conn struct {
	ws      *websocket.Conn
	send    chan []byte
	closing chan struct{}
	once    sync.Once
	written chan struct{} // closed when writeLoop exits
}

func (c *conn) Send(b []byte) bool {
	select {
	case c.send <- b:
		return true
	default:
		return false
	}
}

func (c *conn) Close() { c.once.Do(func() { close(c.closing) }) }

// Handler serves /ws.
func Handler(reg *game.Registry, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// The app (Expo Go) and the TV can come from any origin.
			InsecureSkipVerify: true,
		})
		if err != nil {
			return
		}
		wsConn.SetReadLimit(readLimit)
		c := &conn{ws: wsConn, send: make(chan []byte, sendBuffer), closing: make(chan struct{}), written: make(chan struct{})}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		go c.writeLoop(ctx, cancel)
		go c.pingLoop(ctx, cancel)
		c.readLoop(ctx, reg, log.With("remote", r.RemoteAddr))
		// readLoop closed c: let the writer flush (e.g. a final error) before cancelling.
		<-c.written
	}
}

// pong is the reply to every ping.
var pong, _ = json.Marshal(protocol.Envelope{Type: protocol.TypePong})

func (c *conn) readLoop(ctx context.Context, reg *game.Registry, log *slog.Logger) {
	var room *game.Room
	defer func() {
		if room != nil {
			room.PostLeave(c)
		}
		c.Close()
	}()
	for {
		typ, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var env protocol.Envelope
		if err := json.Unmarshal(data, &env); err != nil || env.Type == "" {
			c.sendError(protocol.ErrBadMessage, "expected JSON with a type field")
			continue
		}

		if env.Type == protocol.TypePing {
			// Keepalive, answered here so it works before join and never
			// waits on a busy room.
			c.Send(pong)
			continue
		}
		if room != nil {
			room.PostMessage(c, env.Type, data)
			continue
		}

		// Not joined yet: the first message must be join.
		if env.Type != protocol.TypeJoin {
			c.sendError(protocol.ErrBadMessage, "the first message must be join")
			return
		}
		var j protocol.Join
		if err := json.Unmarshal(data, &j); err != nil {
			c.sendError(protocol.ErrBadMessage, err.Error())
			return
		}
		j.Room = strings.ToUpper(strings.TrimSpace(j.Room)) // judges type "kxqm"
		switch {
		case (j.Role == protocol.RoleTV || j.Role == protocol.RolePlayer) && j.Room == "" && (j.Role == protocol.RoleTV || strings.TrimSpace(j.Name) != ""):
			room = reg.Create()
			if room == nil {
				c.sendError(protocol.ErrRoomFull, "the server has too many rooms open; try again later")
				return
			}
		case j.Room != "":
			room = reg.Get(j.Room)
			if room == nil {
				c.sendError(protocol.ErrRoomNotFound, "no room with code "+j.Room)
				return
			}
		default:
			c.sendError(protocol.ErrBadMessage, "room is required")
			return
		}
		log.Debug("join", "room", room.Code(), "role", j.Role)
		room.PostJoin(c, j)
	}
}

// writeLoop sends queued messages. On Close it flushes what's left, then
// closes the socket.
func (c *conn) writeLoop(ctx context.Context, cancel context.CancelFunc) {
	defer close(c.written)
	defer cancel()
	write := func(b []byte) bool {
		wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
		defer wcancel()
		return c.ws.Write(wctx, websocket.MessageText, b) == nil
	}
	for {
		select {
		case b := <-c.send:
			if !write(b) {
				c.ws.CloseNow()
				return
			}
		case <-c.closing:
			for {
				select {
				case b := <-c.send:
					if !write(b) {
						c.ws.CloseNow()
						return
					}
				default:
					c.ws.Close(websocket.StatusNormalClosure, "")
					return
				}
			}
		case <-ctx.Done():
			c.ws.CloseNow()
			return
		}
	}
}

func (c *conn) pingLoop(ctx context.Context, cancel context.CancelFunc) {
	t := time.NewTicker(pingEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.ws.Ping(pctx)
			pcancel()
			if err != nil {
				cancel()
				return
			}
		}
	}
}

// sendError is for errors before the client has joined a room.
func (c *conn) sendError(code, msg string) {
	b, _ := json.Marshal(protocol.Error{Envelope: protocol.Envelope{Type: protocol.TypeError}, Code: code, Message: msg})
	c.Send(b)
}
