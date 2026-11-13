// Command server is the Phone Orchestra game server: it serves the TV page
// and the WebSocket at /ws.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"orchinizer/server/internal/game"
	"orchinizer/server/internal/ws"
	"orchinizer/server/web"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	t := game.DefaultTimings
	envSeconds(log, "COMPOSE_SECONDS", &t.Compose)
	envSeconds(log, "CALIBRATE_SECONDS", &t.Calibrate)
	envSeconds(log, "PERFORM_SECONDS", &t.Perform)
	envSeconds(log, "VOTE_SECONDS", &t.Vote)
	log.Info("timings", "compose", t.Compose, "calibrate", t.Calibrate, "perform", t.Perform, "vote", t.Vote)
	reg := game.NewRegistry(log, t)

	mux := http.NewServeMux()
	mux.Handle("GET /ws", ws.Handler(reg, log))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("GET /", http.FileServerFS(web.Static()))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Info("listening", "port", port)
	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

// envSeconds overrides a phase length from an environment variable, e.g.
// COMPOSE_SECONDS=45 for the demo.
func envSeconds(log *slog.Logger, name string, d *time.Duration) {
	v := os.Getenv(name)
	if v == "" {
		return
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		log.Warn("ignoring bad env var", "name", name, "value", v)
		return
	}
	*d = time.Duration(n) * time.Second
}
