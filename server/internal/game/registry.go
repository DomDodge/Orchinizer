package game

import (
	"log/slog"
	"math/rand/v2"
	"sync"

	"orchinizer/protocol"
)

// MaxRooms caps how many rooms exist at once, so nobody can exhaust the
// server by opening TV sockets in a loop.
const MaxRooms = 200

// Registry maps room codes to rooms. It is the only state shared between
// goroutines, so it is the only thing behind a mutex.
type Registry struct {
	mu    sync.Mutex
	rooms map[string]*Room
	log   *slog.Logger
}

func NewRegistry(log *slog.Logger) *Registry {
	return &Registry{rooms: map[string]*Room{}, log: log}
}

// Create starts a new room with a unique code, or returns nil if the
// server is at MaxRooms.
func (r *Registry) Create() *Room {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.rooms) >= MaxRooms {
		r.log.Warn("room limit reached", "rooms", len(r.rooms))
		return nil
	}
	var code string
	for {
		b := make([]byte, protocol.RoomCodeLength)
		for i := range b {
			b[i] = protocol.RoomCodeAlphabet[rand.IntN(len(protocol.RoomCodeAlphabet))]
		}
		code = string(b)
		if _, taken := r.rooms[code]; !taken {
			break
		}
	}
	room := newRoom(code, r, r.log.With("room", code))
	r.rooms[code] = room
	go room.run()
	r.log.Info("room created", "room", code, "rooms", len(r.rooms))
	return room
}

// Get returns the room with this code, or nil.
func (r *Registry) Get(code string) *Room {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rooms[code]
}

func (r *Registry) remove(code string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.rooms, code)
	r.log.Info("room closed", "room", code, "rooms", len(r.rooms))
}
