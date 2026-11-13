# Phone Orchestra server (Go)

This is the source of truth for game state. It serves the TV page at `/` and the WebSocket at `/ws`. The message schema lives in [`../protocol`](../protocol/README.md).

## Run locally
```sh
cd server
go run ./cmd/server            # http://localhost:8080, ws://localhost:8080/ws
go test -race ./... && (cd ../protocol && go test ./...)
```
Until `/tv` has a build, `/` is a placeholder page with a debug TV console: it creates a room and lets you send raw JSON.

## Phase lengths
Phase lengths can be set with environment variables, in seconds: `COMPOSE_SECONDS` (60), `CALIBRATE_SECONDS` (30, a cap), `PERFORM_SECONDS` (45) and `VOTE_SECONDS` (30). On Fly, set them with `fly secrets set COMPOSE_SECONDS=45` or under `[env]` in `fly.toml`.

A quick full game locally:
```sh
COMPOSE_SECONDS=4 PERFORM_SECONDS=6 VOTE_SECONDS=8 go run ./cmd/server &
go run ./cmd/fakeclients -tv -start 6 -q
```

## Layout
- `cmd/server`: HTTP entry point
- `internal/game`: the room registry and one goroutine per room that owns all of that room's state. `room.go` covers connections and sending, `messages.go` the incoming messages, and `game.go` the phases, rounds, bots and votes
- `internal/ws`: per-connection read and write goroutines with a buffered send queue. A client whose buffer fills up is dropped
- `web/static`: the embedded TV page. The Docker build copies the `/tv` build output over it

## Deploy (Fly.io)
```sh
./server/deploy.sh             # from anywhere; builds with the repo root as the context
```
Rooms live in memory, so the app must run on **exactly one machine** that never auto-stops. `deploy.sh` passes `--ha=false`, and `fly.toml` turns auto-stop off.
