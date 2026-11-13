# Frontend prototype protocol and lobby extensions

**Integration status:** This document describes the frontend prototype and its dev lobby, not the current Go server contract. The shared server contract remains in [`../../protocol/README.md`](../../protocol/README.md). Reconcile these contracts before connecting the game screens to the backend.

One WebSocket per client at `wss://<host>/ws`. Every message is JSON: `{"type": "...", ...}`.
Times are **server epoch ms**. Clients estimate `offset = state.serverNow - Date.now()` on each `state`.

## Constants

| Thing | Value |
|---|---|
| Players | 4–8 humans + bots. Server adds bots at `start` until there are 4 seats |
| Seats | 1..8 in join order. Seat color = `COLORS[seat-1]` |
| Colors | `#FF5252 #FFB300 #69F0AE #40C4FF #E040FB #FF6E40 #EEFF41 #18FFFF` |
| Instruments | Picked by players in the lobby from the enabled sections (see Lobby) |
| Pattern | `steps[row][step]`, 5 rows × 8 steps (one bar of 8th notes), booleans |
| Rows (tonal) | row 0 = root … row 4 = top of the major pentatonic: semitones `[0, 2, 4, 7, 9]` above the round's key |
| Rows (drums) | row 0 kick, 1 snare, 2 hat. Rows 3–4 ignored |
| Phase lengths | compose 60 s, calibrate 30 s (ends early on `calibrated`), perform 45 s, vote 30 s (ends early when every online human voted) |
| Rounds | `min(humans, 3)`. Conductor = next human seat in order. Bots never conduct |

## Lobby (revised)

A **phone** hosts: `join` without `room` creates a room. The host conducts round 1, and conducting then rotates
in **join order**. The round-1 conductor picks which instrument sections the game uses, and everyone (including the
conductor, for the rounds they don't conduct) picks one instrument from those sections. Each instrument can
belong to only one player. This replaces the server dealing bass/pad/lead/drums.

- Sections and instruments: `CATEGORIES` / `INSTRUMENTS` in `src/protocol.ts` (strings, wind, percussion, keys).
- Disconnect (socket drops): keep the seat and pick, set `online: false`. The same `id` rejoining gets them back.
- `leave`: remove the player and free their instrument. If they were first in join order, the next player conducts.
- `kick`: the round-1 conductor can remove another player from the lobby, online or offline. Frees their seat and instrument. If connected, send `kicked` before closing their socket; the client returns home and stops automatic reconnects. This is removal, not a ban: they can manually join again.
- Seats: the lowest free number 1..8. `players[]` is sent in **join order** (that's the conducting order).
- Reference implementation the app is tested against: `scripts/mock-lobby.mts`.

| type | from | fields | rule |
|---|---|---|---|
| `categories` | round-1 conductor | `categories: ("strings"\|"wind"\|"percussion"\|"keys")[]` | at least 1. Clears picks outside the new set |
| `pick` | player | `instrument: string \| null` | must be in an enabled section and not taken. `null` un-picks |
| `leave` | player | — | see above |
| `kick` | round-1 conductor | `seat: number` | lobby only; cannot remove yourself; reject requests from other players |

`state` gains `categories` (enabled sections). In the lobby, `conductor` = the first player in join order.

## Client → server

| type | from | fields | notes |
|---|---|---|---|
| `join` | player, tv | `role: "player"\|"tv"`, `id`, `name`, `room?` | `id` is a random token the client makes once and resends on every reconnect to get its seat back. A player omitting `room` hosts a new one (see Lobby) |
| `host_action` | tv | `action: "start"\|"next"\|"skip"\|"restart"` | start: lobby→round 1. next: end current phase now. skip: end this round. restart: results→lobby |
| `pattern` | player | `steps` | Send on every change during compose. Locked at deadline; empty → default |
| `calibrated` | conductor | `angles: {"<seat>": deg}` | Relative to the first seat. Ends calibrate |
| `select` | conductor | `seat` (0 = none) | ≤10/s, only on change. Relayed to TV |
| `cue` | conductor | `id`, `seat`, `action: "in"\|"out"\|"all_out"` | Toggle decided by the conductor from `state.live`. `all_out` = big finish (seat 0). Relayed to TV |
| `volume` | conductor | `seat`, `level` 0–100 | ≤10/s. Relayed to TV |
| `cue_scheduled` | tv | `id`, `beat` | The beat the TV actually played the cue on → replay log |
| `bar` | tv | `bar`, `tempo` | Once per bar at the downbeat. Relayed to all players |
| `vote` | player | `round` | Can't vote for a round you conducted. Re-voting moves your vote |

Messages from anyone other than this round's conductor (`select`, `cue`, `volume`, `calibrated`) or the TV (`host_action`, `cue_scheduled`, `bar`) are ignored.

## Server → client

| type | to | fields |
|---|---|---|
| `welcome` | joiner | `room`, `seat` (0 for tv) |
| `state` | all, on every change | see below |
| `select` / `cue` / `volume` | tv | same fields as sent |
| `bar` | players | same fields as sent |
| `error` | sender | `msg` |
| `kicked` | removed player | —; sent before closing their socket |

### `state`

```jsonc
{
  "type": "state",
  "room": "ABCD",
  "phase": "lobby",            // lobby | compose | calibrate | perform | vote | results
  "round": 1, "rounds": 3,     // round is 0 in lobby
  "conductor": 2,              // seat conducting this round, 0 if none
  "key": "D", "tempo": 110,
  "deadline": 1763050000000,   // 0 if the phase has no timer
  "serverNow": 1763049990000,
  "players": [{ "seat": 1, "name": "Ana", "color": "#FF5252", "instrument": "bass", "online": true, "bot": false, "notes": 5 }],
  "patterns": { "1": [[true,false,...], ...] },   // this round's patterns by seat
  "live": { "1": 80 },         // seats currently playing → volume
  "performances": [{ "round": 1, "conductor": 2, "name": "Ben", "key": "D", "tempo": 110,
                     "patterns": { "1": [[...]] }, "instruments": { "1": "bass" },
                     "cues": [{ "seat": 1, "action": "in", "beat": 4 }], "votes": 3 }],
  "winner": 0                   // round number once results are in
}
```
