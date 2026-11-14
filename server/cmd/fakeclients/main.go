// Command fakeclients connects fake players (and optionally a fake TV) to a
// Phone Orchestra server, so the TV and the app can be tested without
// rounding up six people.
//
//	go run ./cmd/fakeclients -room KXQM                 # 6 players join an existing room
//	go run ./cmd/fakeclients -tv                        # also create the room with a fake TV
//	go run ./cmd/fakeclients -tv -start 6               # fake TV sends host start at 6 players
//	go run ./cmd/fakeclients -url wss://orchinizer.fly.dev/ws -room KXQM
//
// Each fake player sends a random pattern when it joins and on every
// compose, tweaks it a few times, conducts when state.conductor is its seat
// (or, while no conductor is set, if it's the -conduct player).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"os/signal"
	"sync"
	"time"

	"github.com/coder/websocket"

	"orchinizer/protocol"
)

var (
	url     = flag.String("url", "ws://localhost:8080/ws", "server WebSocket URL")
	room    = flag.String("room", "", "room code to join (not needed with -tv)")
	n       = flag.Int("n", 6, "number of fake players")
	fakeTV  = flag.Bool("tv", false, "also run a fake TV that creates the room, sends bar, and answers cues")
	start   = flag.Int("start", 0, "with -tv: send host start once this many players are in (0 = never)")
	conduct = flag.Int("conduct", 1, "while no conductor is set, which fake player (1-based) sends cues; 0 = none")
	quiet   = flag.Bool("q", false, "only log joins, phase changes, and errors")
)

func main() {
	flag.Parse()
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	code := *room
	if *fakeTV {
		tv, err := newTV(ctx)
		if err != nil {
			log.Fatalf("tv: %v", err)
		}
		code = tv.room
		go tv.run(ctx)
	}
	if code == "" {
		log.Fatal("need -room CODE or -tv")
	}
	log.Printf("room %s, %d fake players", code, *n)

	var wg sync.WaitGroup
	for i := 1; i <= *n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b := &bot{idx: i, name: fmt.Sprintf("Fake %d", i), room: code}
			b.run(ctx)
		}()
		time.Sleep(150 * time.Millisecond) // join in a visible order
	}
	wg.Wait()
}

// ---- connection helpers ----

type conn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func dial(ctx context.Context) (*conn, error) {
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(dctx, *url, nil)
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(1 << 20)
	return &conn{ws: ws}, nil
}

func (c *conn) send(v any) {
	b, _ := json.Marshal(v)
	c.mu.Lock()
	defer c.mu.Unlock()
	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c.ws.Write(wctx, websocket.MessageText, b)
}

func env(t, room string) protocol.Envelope { return protocol.Envelope{Type: t, Room: room} }

// ---- fake player ----

type bot struct {
	idx   int
	name  string
	room  string
	token string
	seat  int
	mu    sync.Mutex
	state protocol.State
}

// run connects and keeps reconnecting with the token until ctx ends.
func (b *bot) run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := b.session(ctx); err != nil && ctx.Err() == nil {
			log.Printf("[%s] %v; reconnecting in 2s", b.name, err)
			select {
			case <-time.After(2 * time.Second):
			case <-ctx.Done():
			}
		}
	}
}

func (b *bot) session(ctx context.Context) error {
	c, err := dial(ctx)
	if err != nil {
		return err
	}
	defer c.ws.CloseNow()
	c.send(protocol.Join{Envelope: env(protocol.TypeJoin, b.room), Role: protocol.RolePlayer, Name: b.name, Token: b.token})

	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	states := make(chan protocol.State, 16)
	go b.act(sctx, c, states)

	for {
		_, data, err := c.ws.Read(sctx)
		if err != nil {
			return err
		}
		var e protocol.Envelope
		json.Unmarshal(data, &e)
		switch e.Type {
		case protocol.TypeWelcome:
			var w protocol.Welcome
			json.Unmarshal(data, &w)
			b.token, b.seat = w.Token, w.Seat
			log.Printf("[%s] seat %d %s", b.name, w.Seat, w.Color)
		case protocol.TypeState:
			var s protocol.State
			json.Unmarshal(data, &s)
			select {
			case states <- s:
			default: // act is behind; it only needs the latest
			}
		case protocol.TypeError:
			var m protocol.Error
			json.Unmarshal(data, &m)
			log.Printf("[%s] error %s: %s", b.name, m.Code, m.Message)
			if m.Code == protocol.ErrRoomNotFound || m.Code == protocol.ErrRoomFull || m.Code == protocol.ErrGameInProgress {
				os.Exit(1)
			}
		case protocol.TypeBar:
			if !*quiet && b.idx == 1 {
				var m protocol.Bar
				json.Unmarshal(data, &m)
				log.Printf("[%s] bar %d @ %d bpm", b.name, m.Bar, m.Tempo)
			}
		}
	}
}

// act reacts to state changes: compose and conduct.
func (b *bot) act(ctx context.Context, c *conn, states <-chan protocol.State) {
	var cancelConduct context.CancelFunc = func() {}
	var cancelCompose context.CancelFunc = func() {}
	defer func() { cancelConduct(); cancelCompose() }()
	lastPhase, lastRound, conducting, sentPattern := "", -1, false, false

	for {
		var s protocol.State
		select {
		case <-ctx.Done():
			return
		case s = <-states:
		}
		if b.seat == 0 {
			continue // no welcome yet
		}
		b.mu.Lock()
		b.state = s
		b.mu.Unlock()

		phaseChanged := s.Phase != lastPhase || s.Round != lastRound
		if phaseChanged && b.idx == 1 {
			log.Printf("phase %s round %d/%d conductor %d key %s tempo %d", s.Phase, s.Round, s.TotalRounds, s.Conductor, s.Key, s.Tempo)
		}
		lastPhase, lastRound = s.Phase, s.Round
		if phaseChanged {
			cancelCompose() // stop tweaking: patterns lock when compose ends
		}

		if s.Phase == protocol.PhaseLobby {
			for _, p := range s.Players {
				if p.Seat == b.seat && p.Instrument == "" && len(s.Instruments) > 0 {
					inst := s.Instruments[(b.seat-1)%len(s.Instruments)]
					c.send(protocol.Pick{Envelope: env(protocol.TypePick, b.room), Instrument: &inst})
				}
			}
		}
		amConductor := s.Conductor == b.seat || (s.Conductor == 0 && *conduct == b.idx)

		// Compose: a fresh random pattern each round, keeping the lobby pick.
		if s.Conductor != b.seat && s.Phase == protocol.PhaseCompose && (!sentPattern || phaseChanged) {
			sentPattern = true
			pctx, pc := context.WithCancel(ctx)
			cancelCompose = pc
			go b.compose(pctx, c)
		}

		// Calibrate: pretend to point at each seat, then report.
		if phaseChanged && s.Phase == protocol.PhaseCalibrate && s.Conductor == b.seat {
			go b.calibrate(ctx, c, s)
		}

		// Conduct while performing (or in the lobby when no conductor is set).
		shouldConduct := amConductor && (s.Phase == protocol.PhasePerform || (s.Conductor == 0 && s.Phase == protocol.PhaseLobby))
		if shouldConduct && !conducting {
			conducting = true
			cctx, cc := context.WithCancel(ctx)
			cancelConduct = cc
			go b.conduct(cctx, c)
			log.Printf("[%s] conducting", b.name)
		} else if !shouldConduct && conducting {
			conducting = false
			cancelConduct()
		}
	}
}

// compose writes a random part on the shared sheet, then rewrites it a few
// times like a person would.
func (b *bot) compose(ctx context.Context, c *conn) {
	notes := b.randomNotes()
	c.send(protocol.Pattern{Envelope: env(protocol.TypePattern, b.room), Notes: notes})
	for range 2 + rand.IntN(3) {
		if !sleep(ctx, time.Duration(1500+rand.IntN(4000))*time.Millisecond) {
			return
		}
		notes = b.randomNotes()
		c.send(protocol.Pattern{Envelope: env(protocol.TypePattern, b.room), Notes: notes})
	}
}

// slotSteps splits the song into slots that fake players take turns owning, so
// their parts never clash on the shared sheet: a note starts a slot and ends
// at least MinGapSteps before the next one.
const slotSteps = protocol.MaxNoteSteps

// randomNotes is a valid part in this fake's own slots, with random rows and
// lengths and some slots left empty.
func (b *bot) randomNotes() []protocol.Note {
	var notes []protocol.Note
	for slot := b.idx - 1; slot*slotSteps < protocol.LoopSteps && len(notes) < protocol.MaxNotes; slot += *n {
		if rand.Float64() < 0.3 {
			continue
		}
		start := slot * slotSteps
		notes = append(notes, protocol.Note{
			ID:     fmt.Sprintf("n%d", start),
			Row:    rand.IntN(protocol.Rows),
			Start:  start,
			Length: 1 + rand.IntN(slotSteps-protocol.MinGapSteps),
		})
	}
	return notes
}

func (b *bot) calibrate(ctx context.Context, c *conn, s protocol.State) {
	angles := map[int]float64{}
	i := 0
	for _, p := range s.Players {
		if p.Seat == b.seat {
			continue
		}
		if !sleep(ctx, 600*time.Millisecond) {
			return
		}
		angles[p.Seat] = float64(i)*25 + rand.Float64()*4 - 2
		c.send(protocol.Select{Envelope: env(protocol.TypeSelect, b.room), Seat: p.Seat})
		i++
	}
	c.send(protocol.Calibrated{Envelope: env(protocol.TypeCalibrated, b.room), Angles: angles})
	log.Printf("[%s] calibrated %d seats", b.name, len(angles))
}

// conduct sweeps select across seats, cues random parts in and out, and rides volume.
func (b *bot) conduct(ctx context.Context, c *conn) {
	in := map[int]bool{}
	cueN := 0
	selectT := time.NewTicker(200 * time.Millisecond) // 5/s, under the 10/s cap
	defer selectT.Stop()
	nextCue := time.After(time.Second)
	for {
		select {
		case <-ctx.Done():
			return
		case <-selectT.C:
			if seats := b.otherSeats(); len(seats) > 0 {
				c.send(protocol.Select{Envelope: env(protocol.TypeSelect, b.room), Seat: seats[rand.IntN(len(seats))]})
			}
		case <-nextCue:
			nextCue = time.After(time.Duration(1000+rand.IntN(2500)) * time.Millisecond)
			seats := b.otherSeats()
			if len(seats) == 0 {
				continue
			}
			seat := seats[rand.IntN(len(seats))]
			action := protocol.CueIn
			if in[seat] {
				action = protocol.CueOut
			}
			in[seat] = !in[seat]
			cueN++
			c.send(protocol.Cue{Envelope: env(protocol.TypeCue, b.room), ID: fmt.Sprintf("s%d-c%d", b.seat, cueN), Seat: seat, Action: action})
			if rand.IntN(3) == 0 {
				c.send(protocol.Volume{Envelope: env(protocol.TypeVolume, b.room), Seat: seat, Level: 40 + rand.IntN(61)})
			}
			if !*quiet {
				log.Printf("[%s] cue %s seat %d", b.name, action, seat)
			}
		}
	}
}

func (b *bot) otherSeats() []int {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []int
	for _, p := range b.state.Players {
		if p.Seat != b.seat {
			out = append(out, p.Seat)
		}
	}
	return out
}

// ---- fake TV ----

type tv struct {
	c     *conn
	room  string
	mu    sync.Mutex
	state protocol.State
	cues  []protocol.Cue // waiting for the next beat
}

func newTV(ctx context.Context) (*tv, error) {
	c, err := dial(ctx)
	if err != nil {
		return nil, err
	}
	c.send(protocol.Join{Envelope: env(protocol.TypeJoin, ""), Role: protocol.RoleTV})
	for {
		_, data, err := c.ws.Read(ctx)
		if err != nil {
			return nil, err
		}
		var w protocol.Welcome
		json.Unmarshal(data, &w)
		if w.Type == protocol.TypeWelcome {
			log.Printf("[tv] created room %s", w.Room)
			return &tv{c: c, room: w.Room}, nil
		}
	}
}

func (t *tv) run(ctx context.Context) {
	go t.clock(ctx)
	started := false
	for {
		_, data, err := t.c.ws.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				log.Fatalf("[tv] disconnected: %v", err)
			}
			return
		}
		var e protocol.Envelope
		json.Unmarshal(data, &e)
		switch e.Type {
		case protocol.TypeState:
			var s protocol.State
			json.Unmarshal(data, &s)
			t.mu.Lock()
			t.state = s
			t.mu.Unlock()
			if *start > 0 && !started && s.Phase == protocol.PhaseLobby && len(s.Players) >= *start && allPicked(s.Players) {
				started = true
				log.Printf("[tv] %d players in, sending host start", len(s.Players))
				t.c.send(protocol.HostAction{Envelope: env(protocol.TypeHostAction, t.room), Action: protocol.HostStart})
			}
		case protocol.TypeCue:
			var m protocol.Cue
			json.Unmarshal(data, &m)
			t.mu.Lock()
			t.cues = append(t.cues, m)
			t.mu.Unlock()
		case protocol.TypePatterns:
			if !*quiet {
				var m protocol.Patterns
				json.Unmarshal(data, &m)
				log.Printf("[tv] patterns: %d parts, locked=%v", len(m.Parts), m.Locked)
			}
		case protocol.TypeError:
			var m protocol.Error
			json.Unmarshal(data, &m)
			log.Printf("[tv] error %s: %s", m.Code, m.Message)
		}
	}
}

// clock plays the TV's role as the musical clock: one beat per quarter
// note at the room's tempo, a bar message every 4 beats, and every waiting
// cue reported as scheduled on the next beat.
func (t *tv) clock(ctx context.Context) {
	beat := 0
	for {
		t.mu.Lock()
		tempo := t.state.Tempo
		cues := t.cues
		t.cues = nil
		t.mu.Unlock()
		if tempo <= 0 {
			tempo = 100
		}
		for _, c := range cues {
			t.c.send(protocol.CueScheduled{Envelope: env(protocol.TypeCueScheduled, t.room), ID: c.ID, Seat: c.Seat, Action: c.Action, Beat: beat})
		}
		if beat%4 == 0 {
			t.c.send(protocol.Bar{Envelope: env(protocol.TypeBar, t.room), Bar: beat / 4, Tempo: tempo})
		}
		beat++
		if !sleep(ctx, time.Minute/time.Duration(tempo)) {
			return
		}
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-ctx.Done():
		return false
	}
}

func allPicked(players []protocol.PlayerState) bool {
	for _, p := range players {
		if p.Instrument == "" {
			return false
		}
	}
	return true
}
