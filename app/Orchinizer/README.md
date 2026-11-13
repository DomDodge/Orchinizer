# Orchinizer phone frontend

Expo SDK 58 / React Native screens for players and conductors: host/join, lobby and instrument selection, compose, calibration, performance, voting, and results. Includes motion controls, haptics, and the audio assets used for note previews.

Run from `app/Orchinizer/`:

```sh
npm ci
EXPO_PUBLIC_SERVER_URL=wss://YOUR_HOST/ws npm start
```

Set the WebSocket URL to a server the phones can reach. For a local server, use the laptop's LAN address instead of `localhost`. The app reports an error if no server URL is configured.

The frontend currently uses an earlier message contract. Integration with the current Go backend still needs token-based reconnects, state/error fields, and the new lobby actions reconciled with the shared protocol in `../../protocol/`. Full gameplay against that backend is not yet verified.

Frontend checks:

```sh
npm test
npx tsc --noEmit
npm run lint
```
