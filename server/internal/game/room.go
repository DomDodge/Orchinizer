package game

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"sort"
	"strings"
	"time"

	"orchinizer/protocol"
)

// Client is one WebSocket connection, as the room sees it.
type Client interface {
	// Send queues a message without blocking. It returns false if the
	// client's buffer is full; the room then drops the client.
	Send(msg []byte) bool
	// Close flushes what's queued and closes the connection.
	Close()
}

// idleTimeout: a room with no connected clients for this long shuts down.
const idleTimeout = 10 * time.Minute

type eventKind int

const (
	evJoin eventKind = iota
	evMessage
	evLeave
	evFlush // send pattern changes held back by patternChanged
)

type event struct {
	kind   eventKind
	client Client
	join   protocol.Join
	typ    string
	raw    []byte
}

type player struct {
	seat       int
	joined     int
	pick       string
	level      int
	name       string
	color      string
	token      string
	client     Client // nil when disconnected (always nil for bots)
	bot        bool
	instrument string
	steps      protocol.Grid
	notes      []protocol.Note // note-editor part; nil for grid-only phones and bots
	noteCount  int
	playing    bool

	lastPattern time.Time // last pattern broadcast, for patternChanged
}

func (p *player) connected() bool { return p.bot || p.client != nil }

// Room owns all of one room's state. Only its run goroutine touches the
// fields below done; everything else talks to it through the Post methods.
type Room struct {
	code    string
	reg     *Registry
	log     *slog.Logger
	timings Timings
	inbox   chan event
	done    chan struct{}

	tv      Client
	tvToken string
	players map[int]*player // by seat

	phase      string
	deadline   time.Time
	timer      *time.Timer // fires at deadline; nil when the phase has none
	key        string
	tempo      int
	categories []string
	sequence   int
	pending    map[string]protocol.Cue
	locked     bool // patterns are locked (compose is over)
	conductor  int
	// Last accepted select/volume, for the 10/s limit.
	lastSelect, lastVolume time.Time
	aimSeat                int  // conductor's latest select, even when rate-limited
	flushPending           bool // an evFlush is on its way

	// The game: conductors in order (fixed at start), the round in
	// progress, and finished rounds' scores.
	order        []int
	round        int // 1-based; 0 in the lobby
	keys         []keyTempo
	performances []protocol.PerformanceSummary
	winner       int
	scorer       *roundScorer
}

func newRoom(code string, reg *Registry, log *slog.Logger, t Timings) *Room {
	return &Room{
		code:       code,
		reg:        reg,
		log:        log,
		timings:    t,
		inbox:      make(chan event, 256),
		done:       make(chan struct{}),
		players:    map[int]*player{},
		phase:      protocol.PhaseLobby,
		key:        "C",
		tempo:      100,
		categories: append([]string{}, protocol.CategoryNames...),
		pending:    map[string]protocol.Cue{},
	}
}

func (r *Room) Code() string { return r.code }

// PostJoin, PostMessage, and PostLeave hand an event to the room goroutine.
// If the room has already shut down, the client is closed.
func (r *Room) PostJoin(c Client, j protocol.Join) { r.post(event{kind: evJoin, client: c, join: j}) }
func (r *Room) PostMessage(c Client, typ string, raw []byte) {
	r.post(event{kind: evMessage, client: c, typ: typ, raw: raw})
}
func (r *Room) PostLeave(c Client) { r.post(event{kind: evLeave, client: c}) }

func (r *Room) post(e event) {
	select {
	case r.inbox <- e:
	case <-r.done:
		if e.kind != evLeave && e.client != nil {
			e.client.Close()
		}
	}
}

func (r *Room) run() {
	idle := time.NewTicker(time.Minute)
	defer idle.Stop()
	scoreTick := time.NewTicker(100 * time.Millisecond)
	defer scoreTick.Stop()
	lastActive := time.Now()
	for {
		var deadline <-chan time.Time
		if r.timer != nil {
			deadline = r.timer.C
		}
		select {
		case e := <-r.inbox:
			r.handle(e)
		case <-deadline:
			r.timer = nil
			r.onDeadline()
		case now := <-scoreTick.C:
			if r.phase == protocol.PhasePerform && r.scorer != nil && r.scorer.expire(now.UnixMilli()) {
				r.broadcastState()
			}
		case <-idle.C:
			if r.connectedCount() > 0 {
				lastActive = time.Now()
			} else if time.Since(lastActive) > idleTimeout {
				r.stopTimer()
				r.reg.remove(r.code)
				close(r.done)
				return
			}
		}
	}
}

func (r *Room) handle(e event) {
	switch e.kind {
	case evJoin:
		r.onJoin(e.client, e.join)
	case evLeave:
		r.onLeave(e.client)
	case evMessage:
		r.onMessage(e.client, e.typ, e.raw)
	case evFlush:
		r.flushPending = false
		r.broadcastState()
		r.sendPatterns()
	}
}

// ---- join / leave ----

func (r *Room) onJoin(c Client, j protocol.Join) {
	switch j.Role {
	case protocol.RoleTV:
		// The TV slot can be taken with the TV's token, or by anyone while no
		// TV is connected (a refreshed browser that lost its token). A phone
		// can't kick a live TV.
		hasToken := j.Token != "" && j.Token == r.tvToken
		if r.tv != nil && r.tv != c && !hasToken {
			r.fail(c, protocol.ErrNotAllowed, "this room already has a TV")
			return
		}
		if r.tv != nil && r.tv != c {
			r.tv.Close()
		}
		r.tv = c
		if r.tvToken == "" {
			r.tvToken = newToken()
		}
		r.sendTo(c, protocol.Welcome{Envelope: r.env(protocol.TypeWelcome), Role: protocol.RoleTV, Token: r.tvToken})
		r.log.Info("tv joined")
		// Catch the TV up: state and the patterns.
		r.broadcastState()
		r.sendPatterns()

	case protocol.RolePlayer:
		if p := r.playerByToken(j.Token); p != nil {
			if p.client != nil && p.client != c {
				p.client.Close()
			}
			p.client = c
			r.welcomePlayer(p)
			r.log.Info("player reconnected", "seat", p.seat, "name", p.name)
			r.broadcastState()
			return
		}
		if j.Token != "" {
			r.fail(c, protocol.ErrNotAllowed, "Your seat expired or was removed. Join the room again.")
			return
		}
		if r.phase != protocol.PhaseLobby {
			r.fail(c, protocol.ErrGameInProgress, "the game has already started")
			return
		}
		name := strings.TrimSpace(j.Name)
		if name == "" {
			msg := "name is required"
			if j.Token != "" {
				msg = "unknown token; join again with a name"
			}
			r.fail(c, protocol.ErrBadMessage, msg)
			return
		}
		if len([]rune(name)) > 16 {
			name = string([]rune(name)[:16])
		}
		seat := r.freeSeat()

		if seat == 0 {
			r.fail(c, protocol.ErrRoomFull, "the room is full")
			return
		}
		r.sequence++
		p := &player{
			seat:   seat,
			name:   name,
			color:  protocol.SeatColors[seat-1],
			token:  newToken(),
			client: c,
			joined: r.sequence,
			level:  80,
		}
		r.players[seat] = p
		r.welcomePlayer(p)
		r.log.Info("player joined", "seat", seat, "name", name)
		r.broadcastState()

	default:
		r.fail(c, protocol.ErrBadMessage, "role must be tv or player")
	}
}

func (r *Room) welcomePlayer(p *player) {
	steps := p.steps
	r.sendTo(p.client, protocol.Welcome{
		Envelope: r.env(protocol.TypeWelcome), Role: protocol.RolePlayer,
		Seat: p.seat, Color: p.color, Token: p.token,
		Instrument: p.instrument, Steps: &steps, Notes: p.notes,
	})
}

func (r *Room) onLeave(c Client) {
	if c == r.tv {
		r.tv = nil
		r.broadcastState()
		r.log.Info("tv left")
		return
	}
	p := r.playerByClient(c)
	if p == nil {
		return
	}
	// The seat (and pattern) stay so the token can take them back: phones
	// drop whenever a screen locks. Seats still disconnected when the host
	// starts are removed then.
	p.client = nil
	r.log.Info("player disconnected", "seat", p.seat, "name", p.name, "phase", r.phase)
	r.broadcastState()
}

// ---- outgoing ----

func (r *Room) env(typ string) protocol.Envelope {
	return protocol.Envelope{Type: typ, Room: r.code}
}

func (r *Room) state() protocol.State {
	s := protocol.State{
		Envelope:     r.env(protocol.TypeState),
		Phase:        r.phase,
		Round:        r.round,
		TotalRounds:  len(r.order),
		Conductor:    r.conductor,
		Key:          r.key,
		Scale:        protocol.ScaleMajorPentatonic,
		Tempo:        r.tempo,
		Instruments:  r.instruments(),
		Host:         r.hostSeat(),
		TVConnected:  r.tv != nil,
		Categories:   append([]string{}, r.categories...),
		Patterns:     map[int]protocol.Grid{},
		Live:         map[int]int{},
		Performances: append([]protocol.PerformanceSummary{}, r.performances...),
		Players:      []protocol.PlayerState{},
		Winner:       r.winner,
	}
	if r.phase == protocol.PhaseLobby {
		s.Conductor = s.Host
	}
	if !r.deadline.IsZero() {
		s.Deadline = r.deadline.UnixMilli()
	}
	s.ServerTime = time.Now().UnixMilli()
	if r.phase == protocol.PhasePerform && r.scorer != nil {
		s.Scoring = &r.scorer.state
	}
	for _, p := range r.seatOrder() {
		s.Patterns[p.seat] = p.steps
		if len(p.notes) > 0 {
			if s.Notes == nil {
				s.Notes = map[int][]protocol.Note{}
			}
			s.Notes[p.seat] = p.notes
		}
		if p.playing {
			s.Live[p.seat] = p.level
		}
		s.Players = append(s.Players, protocol.PlayerState{
			Seat: p.seat, Name: p.name, Color: p.color, Instrument: p.instrument,
			Connected: p.connected(), Bot: p.bot,
			NoteCount: p.noteCount, Playing: p.playing,
		})
	}
	return s
}

func (r *Room) broadcastState() { r.broadcastAll(r.state()) }

// currentParts is every non-conductor seat's pattern, in seat order.
func (r *Room) currentParts() []protocol.Part {
	parts := []protocol.Part{}
	for _, p := range r.seatOrder() {
		if p.seat == r.conductor {
			continue
		}
		parts = append(parts, protocol.Part{Seat: p.seat, Instrument: p.instrument, Steps: p.steps, Notes: p.notes})
	}
	return parts
}

// sendPatterns sends the TV every part for the current round.
func (r *Room) sendPatterns() {
	if r.tv == nil {
		return
	}
	r.sendTo(r.tv, protocol.Patterns{
		Envelope: r.env(protocol.TypePatterns),
		Round:    r.round, Key: r.key, Tempo: r.tempo, Locked: r.locked,
		Parts: r.currentParts(),
	})
}

func (r *Room) broadcastAll(v any) {
	b := mustJSON(v)
	r.sendRaw(r.tv, b)
	for _, p := range r.seatOrder() {
		r.sendRaw(p.client, b)
	}
}

func (r *Room) broadcastPlayers(v any) {
	b := mustJSON(v)
	for _, p := range r.seatOrder() {
		r.sendRaw(p.client, b)
	}
}

func (r *Room) sendTo(c Client, v any) { r.sendRaw(c, mustJSON(v)) }

// sendRaw drops a client whose buffer is full rather than blocking the room.
// The drop shows up later as a normal leave event from its read goroutine.
func (r *Room) sendRaw(c Client, b []byte) {
	if c == nil {
		return
	}
	if !c.Send(b) {
		r.log.Warn("send buffer full, dropping client")
		c.Close()
	}
}

func (r *Room) reject(c Client, msg string) {
	r.sendTo(c, protocol.Error{Envelope: r.env(protocol.TypeError), Code: protocol.ErrNotAllowed, Message: msg})
}

// fail rejects a join and closes the connection.
func (r *Room) fail(c Client, code, msg string) {
	r.sendTo(c, protocol.Error{Envelope: r.env(protocol.TypeError), Code: code, Message: msg})
	c.Close()
}

func (r *Room) decode(c Client, raw []byte, v any) bool {
	if err := json.Unmarshal(raw, v); err != nil {
		r.sendTo(c, protocol.Error{Envelope: r.env(protocol.TypeError), Code: protocol.ErrBadMessage, Message: err.Error()})
		return false
	}
	return true
}

// ---- helpers ----

func (r *Room) seatOrder() []*player {
	out := make([]*player, 0, len(r.players))
	for seat := 1; seat <= protocol.MaxPlayers; seat++ {
		if p := r.players[seat]; p != nil {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].joined < out[j].joined })
	return out
}

func (r *Room) freeSeat() int {
	for seat := 1; seat <= protocol.MaxPlayers; seat++ {
		if r.players[seat] == nil {
			return seat
		}
	}
	return 0
}

func (r *Room) playerByToken(tok string) *player {
	if tok == "" {
		return nil
	}
	for _, p := range r.players {
		if p.token == tok {
			return p
		}
	}
	return nil
}

func (r *Room) playerByClient(c Client) *player {
	for _, p := range r.players {
		if p.client == c {
			return p
		}
	}
	return nil
}

func (r *Room) connectedCount() int {
	n := 0
	if r.tv != nil {
		n++
	}
	for _, p := range r.players {
		if p.client != nil {
			n++
		}
	}
	return n
}

func countNotes(g protocol.Grid) int {
	n := 0
	for _, row := range g {
		for _, on := range row {
			if on {
				n++
			}
		}
	}
	return n
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func validAction(a string) bool { return a == protocol.CueIn || a == protocol.CueOut }

func newToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only our own structs get here
	}
	return b
}
