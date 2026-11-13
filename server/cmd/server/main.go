// Command server is the Phone Orchestra game server: it serves the TV page
// and the WebSocket at /ws.
package main

import (
	"log/slog"
	"net/http"
	"os"

	"orchinizer/server/internal/game"
	"orchinizer/server/internal/ws"
	"orchinizer/server/web"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	reg := game.NewRegistry(log)

	mux := http.NewServeMux()
	mux.Handle("GET /ws", ws.Handler(reg, log))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("GET /", http.FileServerFS(web.Static()))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Info("listening", "port", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}
