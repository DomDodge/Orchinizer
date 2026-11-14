# Phone Orchestra server (Go)

This is the source of truth for game state. It serves the TV page at `/` and the WebSocket at `/ws`. The message schema lives in [`../protocol`](../protocol/README.md).

## Run locally
```sh
cd server
go run ./cmd/server            # http://localhost:8080, ws://localhost:8080/ws
go test -race ./... && (cd ../protocol && go test ./...)
```
Until `/tv` has a build, `/` is a placeholder page with a debug TV console: it creates a room and lets you send raw JSON.

## Expo URL for the QR code
The TV reads `GET /config` to get the URL its QR code should open. Set it whenever the Expo tunnel URL changes:
```sh
fly secrets set EXPO_URL=exp://xxxx-anonymous-8081.exp.direct -a orchinizer
```
This restarts the machine, which **wipes rooms**, so set it before people join.

## Phase lengths
Phase lengths can be set with environment variables, in seconds: `COMPOSE_SECONDS` (180), `CALIBRATE_SECONDS` (30, a cap) and `PERFORM_SECONDS` (45). `MAX_ROUNDS` caps the rounds per game (default 0: one per player, so everyone conducts; with a cap, the first players to join conduct). On Fly, set them with `fly secrets set COMPOSE_SECONDS=45` or under `[env]` in `fly.toml`.

A quick full game locally:
```sh
COMPOSE_SECONDS=4 PERFORM_SECONDS=6 go run ./cmd/server &
go run ./cmd/fakeclients -tv -start 6 -q
```

## Layout
- `cmd/server`: HTTP entry point
- `internal/game`: the room registry and one goroutine per room that owns all of that room's state. `room.go` covers connections and sending, `messages.go` the incoming messages, and `game.go` the phases, rounds, bots and results
- `internal/ws`: per-connection read and write goroutines with a buffered send queue. A client whose buffer fills up is dropped
- `web/static`: the embedded TV page. The Docker build copies the `/tv` build output over it

## Deploy (Fly.io)
```sh
./server/deploy.sh             # from anywhere; builds with the repo root as the context
```
Rooms live in memory, so the app must run on **exactly one machine** that never auto-stops. `deploy.sh` passes `--ha=false`, and `fly.toml` turns auto-stop off.

## Phone frontend integration

Use the matching frontend and shared protocol revision. A named player may create a room by omitting `room` from `join`; the first human in join order is the host. The host enables sections, players pick unique instruments, and the host can remove online/offline players in the lobby. Picks remain reserved across disconnects and persist through conductor rotation and game restarts.

The TV joins an existing phone-created room with `{"type":"join","role":"tv","room":"ABCD"}`. Start requires an attached TV and picks for every connected human. The host phone can send `host_action: start` and `restart`. TV phase controls and audio messages are unchanged; the TV UI is not part of this integration.

`state` includes `host`, `tvConnected`, `categories`, per-seat `patterns`, and each player's volume `level`. It always sends a `performances` array. Invalid reconnect tokens are rejected to prevent removed clients automatically reclaiming a seat.

Run `npm run test:integration` from `app/Orchinizer/` to build an isolated local server and exercise the actual phone network module through a two-round game with a simulated TV. This does not use the deployed server.
