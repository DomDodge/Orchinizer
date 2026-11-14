# Running the demo

This is the handoff for running Phone Orchestra without Bryson or his laptop. It is written for a teammate or their Claude Code: read all of it before changing anything.

## What's live and what isn't

| Piece | Where it runs | Needs Bryson? |
|---|---|---|
| Game server + TV page | Fly.io, app `orchinizer`: https://orchinizer.fly.dev (TV page at `/`, WebSocket at `wss://orchinizer.fly.dev/ws`) | **No.** It runs all the time (`auto_stop_machines = "off"`, 1 machine). |
| Phone app | An Expo dev server on **someone's laptop**, through an ngrok tunnel: `exps://fvtpeqm-orchinizer-demo-8081.exp.direct` | It ran on Bryson's laptop. **If that laptop is off, someone else must run it** (below). |
| Server settings (timings, QR link) | Fly secrets | **No.** Use the **Deploy server** GitHub Action. |

The TV page's QR code opens whatever `GET https://orchinizer.fly.dev/config` returns (`expoUrl`), which is the `EXPO_URL` Fly secret. Right now that is the link above.

Server timings at handoff (check with `curl https://orchinizer.fly.dev/config` for the link; timings are in the server's startup log): compose **60 s**, calibrate cap **60 s**, perform **45 s**, **2 rounds** per game. These are short test values; they are fine for a demo.

## Before the demo: run the phone app

Do this on one laptop that stays awake and online for the whole demo. Do a dry run the night before.

1. Get the code and install:
   ```sh
   git clone https://github.com/DomDodge/Orchinizer.git && cd Orchinizer/app/Orchinizer
   npm install
   ```
2. Log the Expo CLI into the shared **`orchinizer-demo`** Expo account. Ask Bryson for the password (it is not in this repo).
   ```sh
   npx expo login
   ```
   Why this account: on iPhone, Expo Go only opens a dev server whose Expo account matches the account signed in on the phone. Players sign into Expo Go as `orchinizer-demo` too. If the CLI is logged into someone's personal account, every iPhone will be asked to sign in as that person.
3. Make the tunnel come out at the **same link the TV already shows**. Expo builds the tunnel name from a per-checkout value, the account name and the port, so set the value:
   ```sh
   mkdir -p .expo && echo '{"urlRandomness": "fvTpeqM"}' > .expo/settings.json
   ```
4. Start it on port 8081, pointed at the live server:
   ```sh
   EXPO_PUBLIC_SERVER_URL=wss://orchinizer.fly.dev/ws npx expo start --tunnel ngrok --no-dev --minify --clear --port 8081
   ```
   (Windows PowerShell: `$env:EXPO_PUBLIC_SERVER_URL="wss://orchinizer.fly.dev/ws"; npx expo start ...`)
   - Use `--tunnel ngrok`. The default tunnel was unreliable for us.
   - `--no-dev --minify` makes a production-like bundle: much faster on phones, and avoids dev-mode slowness.
   - If it says port 8081 is busy, something else (an old Expo) is using it: stop it. On another port the link changes.
5. Check the link it prints. If it is `exps://fvtpeqm-orchinizer-demo-8081.exp.direct`, the TV's QR code works as is. **If it's different**, either set it with the Deploy server action (`expo_url` input; restarts the server, so do it before people join), or just have players scan the QR code in the Expo terminal instead of the TV's.
6. Open the app once on a phone before the demo so the bundle is built and cached (the first load takes a while).

## Changing server settings (no Fly login needed)

GitHub > Actions > **Deploy server** > Run workflow, or:
```sh
gh workflow run deploy-server.yml -R DomDodge/Orchinizer -f compose_seconds=90 -f max_rounds=2
gh workflow run deploy-server.yml -R DomDodge/Orchinizer -f expo_url=exps://xxxx-orchinizer-demo-8081.exp.direct
gh workflow run deploy-server.yml -R DomDodge/Orchinizer -f reset_timings=true   # back to 180/30/45, one round per player
```
Every run deploys `main` and **restarts the server, ending every room in progress**. Never run it mid-game. Blank inputs leave a setting as it is.

| Input | Default | Notes |
|---|---|---|
| `compose_seconds` | 180 | |
| `calibrate_seconds` | 30 | A cap: ends early once the conductor finishes. 30 was often too short for gyro calibration; 60–90 is safer. |
| `perform_seconds` | 45 | Keep ≥ 45: the song is 16 bars (~40–55 s depending on tempo). |
| `max_rounds` | 0 | 0 = one round per player so everyone conducts. |
| `expo_url` | | The link the TV's QR code opens. Must start with `exp://` or `exps://`. |

It uses the `FLY_API_TOKEN` repo secret: a Fly deploy token for this one app only, which **expires 2026-12-14**. After that, Bryson has to make a new one (`fly tokens create deploy -a orchinizer`).

Also: the TV has host actions. `next` ends the current phase now, `skip` jumps to results. Use those to move a stuck demo along instead of redeploying.

## Backup: fully local (no internet)

If the venue has no usable internet, run everything on one laptop. **Untested; rehearse it first.**

- All phones and the laptop on one network you control (phone hotspot or travel router). School/venue Wi-Fi often blocks device-to-device traffic, and then phones can't reach the laptop.
- Server (needs Go 1.27+): `cd server && COMPOSE_SECONDS=60 CALIBRATE_SECONDS=60 MAX_ROUNDS=2 go run ./cmd/server`. TV page: `http://<laptop-ip>:8080` in a browser.
- App: `cd app/Orchinizer && EXPO_PUBLIC_SERVER_URL=ws://<laptop-ip>:8080/ws npx expo start --lan --no-dev --minify --port 8081`, and scan the QR code in the terminal (the TV's QR code won't know this link unless you also set `EXPO_URL=exp://<laptop-ip>:8081` when starting the server).
- Risk: iPhones may refuse plain `ws://`. If phones connect to Expo but never join a room, that's likely why; fall back to the hosted setup.

## Troubleshooting

- **A phone is stuck on an old screen:** it should reconnect by itself within ~15 s (ping/pong keepalive). If not, close and reopen the app; it rejoins the same seat.
- **iPhones asked to sign into someone's account:** the Expo CLI is logged into the wrong account. Step 2.
- **Gyro conducting falls back to buttons:** calibration timed out. Raise `calibrate_seconds`.
- **Smoke-test the server with fake players** (needs Go): `cd server && go run ./cmd/fakeclients -url wss://orchinizer.fly.dev/ws -tv -n 3 -start 3 -conduct 1`. It should print `created room` and go from lobby into compose.
- **Server logs:** only with Fly access (Bryson): `fly logs -a orchinizer`.

## Rules for a Claude working on this

- Don't redeploy or change settings while anyone is in a game: it wipes all rooms.
- Before deploying, run the checks: `cd server && go vet ./... && go test ./...`, `cd protocol && go test ./...`, `cd app/Orchinizer && npm test && npx tsc --noEmit && npx expo lint`, `cd tv && npm run build`.
- Don't set `playbackRate` on expo-audio players in the app: a non-integer rate hangs the JS thread on iOS.
- Don't commit `node_modules/`, `.expo/` or build output (see `.gitignore`).
- Protocol changes go in both `protocol/messages.go` and `protocol/messages.ts` (and `protocol/README.md`).
