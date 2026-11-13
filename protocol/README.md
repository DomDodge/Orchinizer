# Phone Orchestra protocol

**This folder is shared. Get the team's agreement before changing anything in it, and announce every change in the group chat.**

- `messages.ts` holds the TypeScript types for the app and the TV.
- `messages.go` and `constants.go` hold the Go structs and constants for the server, mirroring `messages.ts` field for field.
- `examples/` has one JSON example for every message type. `go test ./...` checks that each one decodes into its struct and encodes back to the same JSON.

## Connection

- Use one WebSocket per client: `wss://<host>/ws` (locally `ws://localhost:8080/ws`).
- Every message is a JSON text frame: `{"type": "...", "room": "KXQM", ...}`.
- The first message must be `join`. Anything sent before it gets an `error` and the socket is closed.
- Save the `token` from `welcome`. To reconnect, send `join` again with the same `room` and `token` to get your seat back. The server then sends `welcome` and the full `state`.

## Agreed constants

| | |
|---|---|
| Room code | 4 letters from `A–Z` without `I` or `O`, e.g. `KXQM` |
| Players | 4–8. Bots fill empty seats up to 4 when the host starts |
| Seats | Numbered from 1. `0` means none |
| Colors | `SeatColors[seat-1]` (see `constants.go`) |
| Instruments | Each round is dealt from one group. The only group for now is **strings**: `contrabass`, `cello`, `viola`, `violin` |
| Scale | Major pentatonic `[0,2,4,7,9]` semitones above `state.key`. Grid row 0 is the lowest note |
| Grid | `steps[row][step]`: 5 rows × 8 steps (one bar of eighth notes) |
| Deadline | Unix **milliseconds**. Count down against your own clock |
| Rounds | One per real player, so everyone conducts once. Bots never conduct |

## Messages

| type | from → to | key fields |
|---|---|---|
| `join` | any → server | `role` (`tv`/`player`), `name`, `token?`. A TV that sends no `room` creates a room |
| `welcome` | server → joiner | `role`, `seat`, `color`, `token` |
| `error` | server → one client | `code`, `message` |
| `state` | server → all | full state: `phase`, `round`, `totalRounds`, `conductor`, `deadline`, `key`, `scale`, `tempo`, `instruments`, `players[]`, `performances`, `winner` |
| `pattern` | player → server | `instrument`, `steps`. Send it on every change during compose |
| `patterns` | server → tv | `round`, `key`, `tempo`, `parts[]`, `locked`. Sent on every pattern change, and again with `locked: true` when compose ends |
| `calibrated` | conductor → server → tv | `angles` (seat → degrees relative to seat 1). Ends calibrate and starts perform |
| `select` | conductor → server → tv | `seat` (max 10/s) |
| `cue` | conductor → server → tv | `id`, `seat`, `action` (`in`/`out`) |
| `volume` | conductor → server → tv | `seat`, `level` 0–100 (max 10/s) |
| `cue_scheduled` | tv → server | `id`, `seat`, `action`, `beat`: the beat it actually played on. Beat 0 is when the transport starts for perform. This is what the replay log stores, and it sets `players[].playing` |
| `bar` | tv → server → players | `bar`, `tempo`. Sent once per bar so phones can pulse on the beat |
| `vote` | player → server | `round`. You can't vote for a round you conducted |
| `host_action` | tv → server | `action`: `start`, `next` (end the current phase now), `skip` (skip the remaining rounds and go to the vote), `restart` (back to the lobby) |
| `performances` | server → tv | `list[]`: round, conductor, key, tempo, parts, cue log. Sent when the vote starts, for replays |

### Who can send what
- The server takes `calibrated`, `select`, `cue` and `volume` only from the seat named in `state.conductor`. Each phone picks its mode from that field.
- `host_action`, `cue_scheduled` and `bar` are accepted from the TV only.

## Game flow

`lobby` → for each round: `compose` (60 s) → `calibrate` (ends when `calibrated` arrives, 30 s cap) → `perform` (45 s) → … → `vote` (30 s) → `results`

The conductor sits out compose. Phones should show the "You're conducting!" screen when `state.conductor` matches their seat.
