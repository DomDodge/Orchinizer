# Orchinizer phone frontend

Expo SDK 58 / React Native screens for players and conductors: host/join, lobby and instrument selection, compose, calibration, performance, voting, and results. Includes motion controls, haptics, and the audio assets used for note previews.

Run from `app/Orchinizer/`:

```sh
npm ci
EXPO_PUBLIC_SERVER_URL=wss://YOUR_HOST/ws npm start
```

Set the WebSocket URL to a server the phones can reach. For a local server, use the laptop's LAN address instead of `localhost`. The app reports an error if no server URL is configured.

The phone imports the shared TypeScript contract from `../../protocol/messages.ts`. The Go server must run the matching revision. From the repository root, start it in another terminal with `cd server && go run ./cmd/server`.

1. Host a room on a phone; other players join with its code and choose names.
2. The host enables sections. Everyone chooses a unique instrument, including the host for later rounds.
3. Connect the TV client to that room (`join` with `role: "tv"` and the room code). The TV owns audio scheduling; its UI is maintained separately.
4. Once the TV is attached and everyone has picked, tap **Start game** on the host phone. Bots fill up to four seats for small test groups.
5. Compose, calibrate, perform, and vote. The host can tap **Back to lobby** after results.

Disconnected phones retain their seat and part using the server's reconnect token for the current app session. **Leave** or a host kick frees the seat and instrument. A removed offline client stops reconnecting when its token is rejected. Reloading the app starts a new session.

Frontend checks:

```sh
npm test
npm run test:integration  # requires Go 1.27; local server + actual phone network module + simulated TV
npx tsc --noEmit
npm run lint
```
