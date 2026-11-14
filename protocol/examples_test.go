package protocol

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every example must decode strictly into its struct and re-encode to the
// same JSON, so the examples, the Go structs, and the docs can't drift.
func TestExamples(t *testing.T) {
	targets := map[string]func() any{
		TypeCategories: func() any { return &Categories{} }, TypePick: func() any { return &Pick{} },
		TypeLeave: func() any { return &Leave{} }, TypeKick: func() any { return &Kick{} }, TypeKicked: func() any { return &Kicked{} }, TypeDone: func() any { return &Done{} },
		TypeJoin: func() any { return &Join{} }, TypeWelcome: func() any { return &Welcome{} },
		TypeError: func() any { return &Error{} }, TypeState: func() any { return &State{} },
		TypePattern: func() any { return &Pattern{} }, TypePatterns: func() any { return &Patterns{} },
		TypeCalibrated: func() any { return &Calibrated{} }, TypeSelect: func() any { return &Select{} },
		TypeCue: func() any { return &Cue{} }, TypeVolume: func() any { return &Volume{} },
		TypeCueScheduled: func() any { return &CueScheduled{} }, TypeBar: func() any { return &Bar{} },
		TypeHostAction: func() any { return &HostAction{} },
	}
	files, _ := filepath.Glob("examples/*.json")
	seen := map[string]bool{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var env Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		mk, ok := targets[env.Type]
		if !ok {
			t.Fatalf("%s: unknown type %q", f, env.Type)
		}
		seen[env.Type] = true
		v := mk()
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		out, _ := json.Marshal(v)
		if strings.TrimSpace(string(raw)) != string(out) {
			t.Errorf("%s round-trip mismatch:\n in: %s\nout: %s", f, raw, out)
		}
	}
	for typ := range targets {
		if !seen[typ] {
			t.Errorf("no example for %q", typ)
		}
	}
}
