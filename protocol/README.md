# Phone Orchestra protocol

**This folder is shared. Get the team's agreement before changing anything in it, and announce every change in the group chat.**

The phone/backend integration adds lobby controls and state fields below. The TV UI remains a separate project; its existing join, pattern, cue, volume, and bar messages are preserved.

- `messages.ts` holds the TypeScript types for the app and the TV.
- `messages.go` and `constants.go` hold the Go structs and constants for the server, mirroring `messages.ts` field for field.
- `examples/` has one JSON example for every message type. `go test ./...` checks that each one decodes into its struct and encodes back to the same JSON.

## Connection

- Use one WebSocket per client: `wss://<host>/ws` (locally `ws://localhost:8080/ws`).
- Every message is a JSON text frame: `{"type": "...", "room": "KXQM", ...}`.
- The first message must be `join`. Anything sent before it gets an `error` and the socket is closed.
- Save the `token` from `welcome`. To reconnect, send `join` again with the same `room` and `token` (the client also resends its name) to get your seat back. The server then sends `welcome` and the full `state`. A player's `welcome` includes their current `instrument` and `steps`, so the sequencer can be restored.
- Room codes are case-insensitive, and surrounding spaces are ignored.
- A player who disconnects keeps their seat, even in the lobby (phones drop whenever a screen locks). Seats still disconnected when the host starts are removed. A full lobby does not silently reclaim offline seats; the host can kick them. An unknown token is rejected, so a removed offline client cannot automatically rejoin.
- **TV:** store the token in `localStorage`. A TV `join` for an existing room is accepted with that token, or by anyone while no TV is connected, so a phone can't kick a live TV.

## Agreed constants

| | |
|---|---|
| Room code | 4 letters from `A–Z` without `I` or `O`, e.g. `KXQM` |
| Players | 4–8. Bots fill empty seats up to 4 when the host starts |
| Seats | Lowest free number from 1. `players[]` is in join order; reusing a seat does not jump ahead in the conductor order. `0` means none |
| Colors | `SeatColors[seat-1]` (see `constants.go`) |
| Instruments | Humans pick unique instruments from host-enabled strings, wind, percussion, and keys sections. See `InstrumentGroups` / `INSTRUMENT_GROUPS`. Picks persist between rounds and games. Bots fill unused active instruments |
| Scale | Major pentatonic `[0,2,4,7,9]` semitones above `state.key`. Grid row 0 is the lowest note |
| Grid | `steps[row][step]`: 5 rows × 8 steps (one bar of eighth notes) |
| Notes | The note editor's part. Each note is `{id, row, start, length, instrument?}`, with times in steps: 4 per beat (16th notes). Everyone writes on one **shared sheet**, the song: 256 steps (16 bars), played from the top in perform. Up to 16 notes per player, each 1–8 steps long. The song is monophonic: no note may overlap any other player's or your own, on any row, and at least 1 step of rest separates one note's end from the next one's start. `instrument` (if set) must be enabled in this game. Every seat's notes are in `state.notes`, so phones can draw the whole sheet |
| Deadline | Unix **milliseconds**. Phone clocks can be off, so count down with `deadline - serverTime - (Date.now() - receivedAt)`, where `receivedAt` is when that `state` arrived |
| Rounds | One per real player, so everyone conducts once. Bots never conduct |

## HTTP

- `GET /config` returns `{"expoUrl": "exp://..."}`. The TV puts this in its QR code. It comes from the server's `EXPO_URL` environment variable, so updating the Expo tunnel URL needs no TV change.
- `GET /healthz` returns `ok`.

## Messages

| type | from → to | key fields |
|---|---|---|
| `join` | any → server | `role` (`tv`/`player`), `name`, `token?`. A TV or named player that sends no `room` creates a room |
| `welcome` | server → joiner | `role`, `seat`, `color`, `token`; for players also `instrument`, `steps` and `notes?` |
| `error` | server → one client | `code`, `message`. Codes: `bad_message`, `room_not_found`, `room_full`, `game_in_progress`, `not_allowed`, `bad_pattern` |
| `state` | server → all | full state: `phase`, `round`, `totalRounds`, `host`, `conductor`, `tvConnected`, `categories`, `deadline`, `serverTime`, `key`, `scale`, `tempo`, `instruments`, `players[]`, `patterns`, `live`, `performances`, `winner`, `scoring?` |
| `categories` | host phone → server | `categories: string[]`; lobby only, at least one section; clears disabled picks |
| `pick` | player → server | `instrument: string \| null`; lobby only, enabled and unique; `null` unpicks |
| `leave` | player → server | lobby only; removes the seat and frees the pick; host passes to the next human in join order |
| `kick` | host phone → server | `seat`; lobby only, another online or offline player; frees their pick |
| `kicked` | server → removed player | before closing the socket; return home and stop automatic reconnects |
| `pattern` | player → server | `instrument`, `steps`, `notes?`. Send it on every change during compose. A note-editor phone sends `notes` and may leave out `steps`. An invalid `notes` gets `error` code `bad_pattern`, and the previous part stays. Broadcasts are batched to about 10 per second per player, and the latest change is always sent |
| `done` | player → server | `done` (bool). Compose only: the sender's part is finished (`true`) or they're editing again (`false`). Shown as `players[].done` |
| `patterns` | server → tv | `round`, `key`, `tempo`, `parts[]`, `locked`. Sent on every pattern change, and again with `locked: true` when compose ends |
| `calibrated` | conductor → server → tv | `angles` (seat → degrees relative to seat 1). Ends calibrate and starts perform |
| `select` | conductor → server → tv | `seat`. Max 10/s: the server drops anything faster |
| `cue` | conductor → server → tv | `id`, `seat`, `action` (`in`/`out`/`all_out`); `all_out` with seat 0 expands to individual `out` cues for the TV |
| `volume` | conductor → server → tv | `seat`, `level` 0–100. Max 10/s: the server drops anything faster, so keep sending at a steady rate while the volume changes, so the final value gets through |
| `cue_scheduled` | tv → server | `id`, `seat`, `action`, `beat`: the beat it actually played on. Beat 0 is when the transport starts for perform. It sets `players[].playing` |
| `bar` | tv → server → players | `bar`, `tempo`. Sent once per bar so phones can pulse on the beat |
| `host_action` | tv or host phone → server | `action`: `start`, `next` (end the current phase now), `skip` (skip the remaining rounds and go to the results), `restart` (back to the lobby) |

### Who can send what
- The server takes `calibrated`, `select`, `cue` and `volume` only from the seat named in `state.conductor`. Each phone picks its mode from that field.
- `cue_scheduled` and `bar` are accepted from the TV only. The host phone may send `host_action: start` and `restart`; `next` and `skip` remain TV-only.
- Lobby actions are locked during a game. `pattern.instrument` cannot bypass pick uniqueness or change an instrument after Start.
- `state.host` is the first human in join order, including an offline host until they explicitly leave. In the lobby, `state.conductor` equals `host`.
- `state.patterns` maps seats to grids for restoring composition after reconnects. `state.live` maps currently playing seats to volume 0–100. Playing status changes only after a matching TV `cue_scheduled`, counted once. `performances` is always an array of finished rounds, in round order, with key, tempo and `score`.

## Game flow

`lobby` → for each round: `compose` (180 s) → `calibrate` (ends when `calibrated` arrives, 30 s cap) → `perform` (45 s) → … → `results`

- **Start** (`host_action: start`): requires an attached TV and a selected instrument for every connected human. Seats still disconnected are removed, and bots fill up to 4 seats. The conductor order is every real player in join order, so there's one round per player. Bots never conduct.
- **Each round:** a new `key` and `tempo`. Human instrument picks are restored; bots take unused instruments among the enabled sections. The conductor's `instrument` is `""`, and they sit compose out. Phones should show the "You're conducting!" screen when `state.conductor` matches their seat.
- **Compose:** patterns are accepted in the lobby (for testing) and during compose. During compose a part must be `notes` on the shared sheet; a grid (`steps`) gets `bad_pattern`. A part that clashes with another player's notes also gets `bad_pattern`, naming them ("Too close to Sebas's note"), and the previous part stays. Compose ends early once every connected human composing this round has sent `done: true` (bots are always done; disconnected players don't hold it up). Phones lock their editor while done. `done` resets each round. When compose ends the parts lock, and every empty part (bots, and players who wrote nothing) gets up to 8 notes in the sheet's free space. The TV then gets `patterns` with `locked: true`.
- **Calibrate:** the conductor may send `select` and `calibrated`. `calibrated` starts perform right away. While the conductor is disconnected the deadline is 60 s instead of 30 s; their reconnect restarts the full 30 s.
- **Perform:** the conductor may send `select`, `cue` and `volume`. See *Conductor scoring* below.
- **A conductor who is disconnected when their round starts is skipped.**
- **Results:** `state.winner` is the round with the most points, and a tie goes to the earlier round. There is no vote: the last perform goes straight to results. The game stays here until `next` or `restart`, which go back to the lobby with the same players.
- **Host actions:** `next` ends the current phase now. `skip` jumps to the results, scoring the performance in progress (with no performances it goes back to the lobby). `restart` goes back to the lobby from anywhere.
- **Stale conductor messages:** `select` and `volume` from a non-conductor, or in the wrong phase, are dropped silently, because they stream and some always arrive just after a phase change. `cue` and `calibrated` get an `error`.

## Conductor scoring (additive fields)

During perform, `state.scoring` contains `summary`, `combo`, `targets`, and optional `last` judgment. Targets have `{id, kind, seat, action?, at, end?, result}`; `at` and `end` are Unix milliseconds on the same server clock as `serverTime`. `kind` is the gesture the prompt wants (see *Note types* below). Show the next pending target and send the existing `cue` when the conductor points and flicks/taps. Cue messages and TV audio scheduling stay unchanged; older TV clients can ignore the new state fields.

The first target is four beats after perform starts. Later targets land on bar boundaries spread across the performance; every round gets the same number of prompts regardless of tempo (15 prompts for the default 45 seconds). Seats rotate in join order and each seat alternates `in`/`out`. A correct seat and action within ±120 ms earns Perfect (100 base points); within ±300 ms earns Good (50). Hits 5–9 earn ×2, 10–14 earn ×3, and 15 onward earn ×4. Wrong seat/action or an expired target is a Miss and resets the combo. Early extra cues reset the combo without consuming a future target. Each target resolves once, repeated cue IDs are ignored for the whole round, and all-out cannot score multiple hits.

**Note types** (`kind`):
- `flick`: point at `seat` and flick (or tap) with `action` at `at`. Judged on cue arrival, as above.
- `hold`: keep pointing at `seat` from `at` until `end` (3 beats). No cue is sent. The server scores it from the conductor's `select` stream: aimed at the seat for ≥ 90% of the hold is Perfect, ≥ 60% Good, otherwise Miss. It's judged once `end` passes, and it counts toward the combo like any hit. Every 4th prompt is a hold when it fits before the next prompt. Every `select` is recorded for scoring, including ones the 10/s relay limit drops. **TV:** draw holds as a bar from `at` to `end` (flicks as a dot). Clients that don't know `kind` yet can draw everything as a dot.

The server judges cue arrival before TV beat quantization; it never trusts client scores or timestamps. Network latency can affect the grade. Misses expire automatically even if the conductor sends nothing. Skipping/ending a performance counts all its remaining targets as missed. Reconnects preserve the round, while each new conductor and lobby restart reset live scoring. `score` on performance summaries contains `{points, maxCombo, perfect, good, misses, total}`.
