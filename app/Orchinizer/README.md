# Orchinizer phone frontend

Expo SDK 58 / React Native app for players and conductors. Run commands from `app/Orchinizer/` with Node 26 (the dev server loads TypeScript modules directly).

```sh
npm ci
npm start -- --tunnel ngrok
```

Open the Expo Go link on each phone. The default WebSocket URL uses the same Metro host and tunnel at `/ws`. For web testing, run `npm run web`.

The working development lobby supports hosting and joining with a four-letter code, shared player/role/online status, conductor-selected instrument sections, unique instrument picks, reconnecting to a saved seat, leaving, and conductor-only removal of online or offline players. Tap **✕**, then **Remove?**, to remove someone.

The lobby runs in memory inside Metro. Restarting Expo clears rooms. Disconnected players keep their seat and instrument until they reconnect, leave, or the conductor removes them. The dev lobby stays in the lobby phase; there is no Start game action yet.

## Backend integration

The Go game server is in [`../../server/`](../../server/README.md); its shared contract is in [`../../protocol/`](../../protocol/README.md). `npm run server` starts that server in another terminal.

This frontend still uses a prototype contract described in [`PROTOCOL.md`](PROTOCOL.md). The compose, calibration, performance, vote, and results screens exist, but the full game has not been verified against the current Go backend. Integration must reconcile token-based reconnects, `serverTime`, error/state fields, and the new phone-hosted lobby, categories, picks, leave, and kick messages. Setting a server URL alone does not resolve those differences.

Once the contracts match, select the game server with:

```sh
EXPO_PUBLIC_SERVER_URL=wss://YOUR_HOST/ws npm start -- --tunnel ngrok
```

## Checks and development tools

```sh
npm test
npx tsc --noEmit
npm run lint
npm run sounds       # regenerate bundled instrument WAVs
npm run sensor-log   # receive optional sensor-test recordings locally
```

Long-press the home-screen title to open the sensor test, then use **Point & select test** to test calibration and cues. The gesture tests cover heading wrap, target selection, flick cooldown/re-arming, tilt volume, and the all-out gesture. Lobby and network tests cover pick ownership, host privileges, removal, and reconnect behavior. Sensor CSV recordings are ignored by Git.
