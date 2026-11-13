# Phone Orchestra server (Go)

This is the source of truth for game state. It serves the TV page at `/` and the WebSocket at `/ws`. The message schema lives in [`../protocol`](../protocol/README.md).

## Run locally
```sh
cd server
go run ./cmd/server            # http://localhost:8080, ws://localhost:8080/ws
go test -race ./... && (cd ../protocol && go test ./...)
```
Until `/tv` has a build, `/` is a placeholder page with a debug TV console: it creates a room and lets you send raw JSON.

## Layout
- `cmd/server`: HTTP entry point
- `internal/game`: the room registry and one goroutine per room that owns all of that room's state
- `internal/ws`: per-connection read and write goroutines with a buffered send queue. A client whose buffer fills up is dropped
- `web/static`: the embedded TV page. The Docker build copies the `/tv` build output over it

## Deploy (Fly.io)
```sh
./server/deploy.sh             # from anywhere; builds with the repo root as the context
```
Rooms live in memory, so the app must run on **exactly one machine** that never auto-stops. `deploy.sh` passes `--ha=false`, and `fly.toml` turns auto-stop off.
