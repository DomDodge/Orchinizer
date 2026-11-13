package game

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
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
	name       string
	color      string
	token      string
	client     Client // nil when disconnected (or a bot)
	bot        bool
	instrument string
	steps      protocol.Grid
	noteCount  int
	playing    bool
	voted      bool
}

// Room owns all of one room's state. Only its run goroutine touches the
// fields below inbox; everything else talks to it through Post.
type Room struct {
	code  string
	reg   *Registry
	log   *slog.Logger
	inbox chan event
	done  chan struct{}

	tv      Client
	tvToken string
	players map[int]*player // by seat

	phase       string
	round       int
	totalRounds int
	conductor   int
	deadline    time.Time
	key         string
	tempo       int
	group       string
	cueLog      []protocol.LoggedCue
}

func newRoom(code string, reg *Registry, log *slog.Logger) *Room {
	return &Room{
		code:    code,
		reg:     reg,
		log:     log,
		inbox:   make(chan event, 256),
		done:    make(chan struct{}),
		players: map[int]*player{},
		phase:   protocol.PhaseLobby,
		key:     "C",
		tempo:   100,
		group:   "strings",
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
		if e.kind != evLeave {
			e.client.Close()
		}
	}
}

func (r *Room) run() {
	idle := time.NewTicker(time.Minute)
	defer idle.Stop()
	lastActive := time.Now()
	for {
		select {
		case e := <-r.inbox:
			r.handle(e)
			if r.connectedCount() > 0 {
				lastActive = time.Now()
			}
		case <-idle.C:
			if r.connectedCount() > 0 {
				lastActive = time.Now()
			} else if time.Since(lastActive) > idleTimeout {
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
	}
}

// ---- join / leave ----

func (r *Room) onJoin(c Client, j protocol.Join) {
	switch j.Role {
	case protocol.RoleTV:
		// A TV join always takes the TV slot. That way a refreshed browser
		// that lost its token can still get back in.
		if r.tv != nil && r.tv != c {
			r.tv.Close()
		}
		r.tv = c
		if r.tvToken == "" {
			r.tvToken = newToken()
		}
		r.sendTo(c, protocol.Welcome{Envelope: r.env(protocol.TypeWelcome), Role: protocol.RoleTV, Token: r.tvToken})
		r.log.Info("tv joined")
		r.broadcastState()
		r.sendPatterns(false)

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
		if r.phase != protocol.PhaseLobby {
			r.fail(c, protocol.ErrGameInProgress, "the game has already started")
			return
		}
		name := strings.TrimSpace(j.Name)
		if name == "" {
			r.fail(c, protocol.ErrBadMessage, "name is required")
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
		inst := protocol.InstrumentGroups[r.group]
		p := &player{
			seat:       seat,
			name:       name,
			color:      protocol.SeatColors[seat-1],
			token:      newToken(),
			client:     c,
			instrument: inst[(seat-1)%len(inst)],
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
	r.sendTo(p.client, protocol.Welcome{
		Envelope: r.env(protocol.TypeWelcome), Role: protocol.RolePlayer,
		Seat: p.seat, Color: p.color, Token: p.token,
	})
}

func (r *Room) onLeave(c Client) {
	if c == r.tv {
		r.tv = nil
		r.log.Info("tv left")
		return
	}
	p := r.playerByClient(c)
	if p == nil {
		return
	}
	if r.phase == protocol.PhaseLobby {
		// In the lobby, leaving gives up the seat.
		delete(r.players, p.seat)
		r.log.Info("player left", "seat", p.seat, "name", p.name)
	} else {
		// Mid-game the seat and pattern stay; the token gets them back.
		p.client = nil
		r.log.Info("player disconnected", "seat", p.seat, "name", p.name)
	}
	r.broadcastState()
}

// ---- messages ----

func (r *Room) onMessage(c Client, typ string, raw []byte) {
	isTV := c == r.tv
	p := r.playerByClient(c)
	if !isTV && p == nil {
		return // not joined (or replaced by a reconnect)
	}

	switch typ {
	case protocol.TypePattern:
		if p == nil {
			r.reject(c, "only players send patterns")
			return
		}
		if p.seat == r.conductor {
			r.reject(c, "the conductor doesn't compose")
			return
		}
		var m protocol.Pattern
		if !r.decode(c, raw, &m) {
			return
		}
		if m.Instrument != "" {
			if !contains(protocol.InstrumentGroups[r.group], m.Instrument) {
				r.reject(c, "instrument not in this round's group")
				return
			}
			p.instrument = m.Instrument
		}
		p.steps = m.Steps
		p.noteCount = countNotes(m.Steps)
		r.broadcastState()
		r.sendPatterns(false)

	case protocol.TypeSelect, protocol.TypeCue, protocol.TypeVolume, protocol.TypeCalibrated:
		if !r.isConductor(p) {
			r.reject(c, "only the conductor sends "+typ)
			return
		}
		r.relayConductor(c, typ, raw)

	case protocol.TypeCueScheduled:
		if !isTV {
			r.reject(c, "only the tv sends cue_scheduled")
			return
		}
		var m protocol.CueScheduled
		if !r.decode(c, raw, &m) {
			return
		}
		r.cueLog = append(r.cueLog, protocol.LoggedCue{ID: m.ID, Seat: m.Seat, Action: m.Action, Beat: m.Beat})
		if t := r.players[m.Seat]; t != nil {
			t.playing = m.Action == protocol.CueIn
			r.broadcastState()
		}

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
		if !isTV {
			r.reject(c, "only the tv sends host_action")
			return
		}
		r.reject(c, "host_action is not implemented yet")

	case protocol.TypeVote:
		r.reject(c, "vote is not implemented yet")

	case protocol.TypeJoin:
		r.reject(c, "already joined")

	default:
		r.reject(c, "unknown message type "+typ)
	}
}

// isConductor: while no conductor is set (the lobby during development),
// any player may send conductor messages, so cues can be tested early.
func (r *Room) isConductor(p *player) bool {
	if p == nil {
		return false
	}
	return r.conductor == 0 || p.seat == r.conductor
}

// relayConductor validates a conductor message, then forwards it to the TV.
func (r *Room) relayConductor(c Client, typ string, raw []byte) {
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
		out = m
	case protocol.TypeCue:
		var m protocol.Cue
		if !r.decode(c, raw, &m) {
			return
		}
		if r.players[m.Seat] == nil || (m.Action != protocol.CueIn && m.Action != protocol.CueOut) {
			r.reject(c, "cue needs an existing seat and action in/out")
			return
		}
		out = m
	case protocol.TypeVolume:
		var m protocol.Volume
		if !r.decode(c, raw, &m) {
			return
		}
		m.Level = max(0, min(100, m.Level))
		out = m
	case protocol.TypeCalibrated:
		var m protocol.Calibrated
		if !r.decode(c, raw, &m) {
			return
		}
		out = m
	}
	// Re-encode so the TV only ever sees validated fields and the right room.
	r.sendTo(r.tv, withEnvelope(out, r.env(typ)))
}

// ---- outgoing ----

func (r *Room) env(typ string) protocol.Envelope {
	return protocol.Envelope{Type: typ, Room: r.code}
}

func (r *Room) state() protocol.State {
	s := protocol.State{
		Envelope:    r.env(protocol.TypeState),
		Phase:       r.phase,
		Round:       r.round,
		TotalRounds: r.totalRounds,
		Conductor:   r.conductor,
		Key:         r.key,
		Scale:       protocol.ScaleMajorPentatonic,
		Tempo:       r.tempo,
		Instruments: protocol.InstrumentGroups[r.group],
		Players:     []protocol.PlayerState{},
	}
	if !r.deadline.IsZero() {
		s.Deadline = r.deadline.UnixMilli()
	}
	for _, p := range r.seatOrder() {
		s.Players = append(s.Players, protocol.PlayerState{
			Seat: p.seat, Name: p.name, Color: p.color, Instrument: p.instrument,
			Connected: p.bot || p.client != nil, Bot: p.bot,
			NoteCount: p.noteCount, Playing: p.playing, Voted: p.voted,
		})
	}
	return s
}

func (r *Room) broadcastState() { r.broadcastAll(r.state()) }

// sendPatterns sends every non-conductor part to the TV.
func (r *Room) sendPatterns(locked bool) {
	if r.tv == nil {
		return
	}
	m := protocol.Patterns{
		Envelope: r.env(protocol.TypePatterns),
		Round:    r.round, Key: r.key, Tempo: r.tempo, Locked: locked,
		Parts: []protocol.Part{},
	}
	for _, p := range r.seatOrder() {
		if p.seat == r.conductor {
			continue
		}
		m.Parts = append(m.Parts, protocol.Part{Seat: p.seat, Instrument: p.instrument, Steps: p.steps})
	}
	r.sendTo(r.tv, m)
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

// withEnvelope sets the envelope on a relayed conductor message.
func withEnvelope(v any, e protocol.Envelope) any {
	switch m := v.(type) {
	case protocol.Select:
		m.Envelope = e
		return m
	case protocol.Cue:
		m.Envelope = e
		return m
	case protocol.Volume:
		m.Envelope = e
		return m
	case protocol.Calibrated:
		m.Envelope = e
		return m
	}
	return v
}
