# Phone Orchestra protocol

**This folder is shared. Get the team's agreement before changing anything in it, and announce every change in the group chat.**

- `messages.ts` holds the TypeScript types for the app and the TV.
- `messages.go` and `constants.go` hold the Go structs and constants for the server, mirroring `messages.ts` field for field.
- `examples/` has one JSON example for every message type. `go test ./...` checks that each one decodes into its struct and encodes back to the same JSON.

## Connection

- Use one WebSocket per client: `wss://<host>/ws` (locally `ws://localhost:8080/ws`).
- Every message is a JSON text frame: `{"type": "...", "room": "KXQM", ...}`.
- The first message must be `join`. Anything sent before it gets an `error` and the socket is closed.
- Save the `token` from `welcome`. To reconnect, send `join` again with the same `room`, `token` **and name** to get your seat back. The server then sends `welcome` and the full `state`. A player's `welcome` includes their current `instrument` and `steps`, so the sequencer can be restored.
- Room codes are case-insensitive, and surrounding spaces are ignored.
- A player who disconnects keeps their seat, even in the lobby (phones drop whenever a screen locks). Seats still disconnected when the host starts are removed.
- **TV:** store the token in `localStorage`. A TV `join` for an existing room is accepted with that token, or by anyone while no TV is connected, so a phone can't kick a live TV.

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
| Deadline | Unix **milliseconds**. Phone clocks can be off, so count down with `deadline - serverTime - (Date.now() - receivedAt)`, where `receivedAt` is when that `state` arrived |
| Rounds | One per real player, so everyone conducts once. Bots never conduct |

## HTTP

- `GET /config` returns `{"expoUrl": "exp://..."}`. The TV puts this in its QR code. It comes from the server's `EXPO_URL` environment variable, so updating the Expo tunnel URL needs no TV change.
- `GET /healthz` returns `ok`.

## Messages

| type | from → to | key fields |
|---|---|---|
| `join` | any → server | `role` (`tv`/`player`), `name`, `token?`. A TV that sends no `room` creates a room |
| `welcome` | server → joiner | `role`, `seat`, `color`, `token`; for players also `instrument` and `steps` |
| `error` | server → one client | `code`, `message` |
| `state` | server → all | full state: `phase`, `round`, `totalRounds`, `conductor`, `deadline`, `serverTime`, `key`, `scale`, `tempo`, `instruments`, `players[]`, `performances`, `winner` |
| `pattern` | player → server | `instrument`, `steps`. Send it on every change during compose |
| `patterns` | server → tv | `round`, `key`, `tempo`, `parts[]`, `locked`. Sent on every pattern change, and again with `locked: true` when compose ends |
| `calibrated` | conductor → server → tv | `angles` (seat → degrees relative to seat 1). Ends calibrate and starts perform |
| `select` | conductor → server → tv | `seat`. Max 10/s: the server drops anything faster |
| `cue` | conductor → server → tv | `id`, `seat`, `action` (`in`/`out`) |
| `volume` | conductor → server → tv | `seat`, `level` 0–100. Max 10/s: the server drops anything faster, so keep sending at a steady rate while the volume changes, so the final value gets through |
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

- **Start** (`host_action: start`): seats still disconnected are removed, and bots fill up to 4 seats. The conductor order is every real player in seat order, so there's one round per player. Bots never conduct or vote.
- **Each round:** a new `key` and `tempo`, and instruments are dealt again so there's a mix. The conductor's `instrument` is `""`, and they sit compose out. Phones should show the "You're conducting!" screen when `state.conductor` matches their seat.
- **Compose:** patterns are accepted in the lobby (for testing) and during compose. When compose ends they lock, and an empty pattern gets a default. The TV then gets `patterns` with `locked: true`.
- **Calibrate:** the conductor may send `select` and `calibrated`. `calibrated` starts perform right away.
- **Perform:** the conductor may send `select`, `cue` and `volume`. The TV's `cue_scheduled` messages make up the replay log.
- **A conductor who is disconnected when their round starts is skipped.**
- **Vote:** the TV gets `performances` (everything needed for replays). You can't vote for a round you conducted. You can change your vote; the last one counts. The vote ends early once everyone eligible has voted. `state.performances` holds the live counts.
- **Results:** `state.winner` is the winning round, and a tie goes to the earlier round. The game stays here until `next` or `restart`, which go back to the lobby with the same players.
- **Host actions:** `next` ends the current phase now. `skip` jumps to the vote, keeping the performance in progress (with no performances it goes back to the lobby). `restart` goes back to the lobby from anywhere.
- **Stale conductor messages:** `select` and `volume` from a non-conductor, or in the wrong phase, are dropped silently, because they stream and some always arrive just after a phase change. `cue` and `calibrated` get an `error`.
