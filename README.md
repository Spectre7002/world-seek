# 🌍 World Seek

🎉 A multiplayer hide-and-seek geo-guessing party game! 🕵️ Each player secretly drops a pin 📍
somewhere in the world (their hiding spot), then everyone takes turns guessing where each
player is hiding using Google Street View. 🏆 Points are awarded by distance — closest wins!

## Project history

The initial game mockup was created by [Ivan Villa](https://ivanvilla.com). This repository
contains the current maintained implementation of the game.



## 🧰 Stack

- ⚡ **Next.js 14** (App Router) for the client
- 🔌 **Socket.IO** on a **custom Node server** that holds all room state in memory and is the
  single source of truth (clients send intents; the server runs the game and pushes a
  redacted per-player state)
- 🗺️ **Google Maps + Street View** for hiding and guessing
- 💬 **Text chat** over Socket.IO, scoped per game
- 🎙️ **Live voice chat** over peer-to-peer **WebRTC** (mesh of direct connections between
  players) — always-on, push-to-talk, or mute, with a mic device picker and a speaking
  indicator. Socket.IO carries signaling (offers/answers/ICE candidates); audio does not pass
  through the World Seek app server, though a TURN relay may carry it

## ✅ Prerequisites

- 🟢 Node.js 18.17 or newer (this repo was verified on Node 24)
- 🔑 A **Google Maps JavaScript API key** with **Maps JavaScript API** and **Street View**
  enabled and **billing on** (in the [Google Cloud console](https://console.cloud.google.com/)).

## ⚙️ Setup

**1. Install dependencies and create your env file**

```bash
npm ci
cp .env.example .env.local
# edit .env.local and set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key
```

**2. 🚨 RESTRICT YOUR GOOGLE MAPS API KEY — do not skip this**

> ### ⚠️ This is a public, browser-side key. Treat it accordingly.
>
> The Maps JavaScript API key is prefixed `NEXT_PUBLIC_` because it **ships to every
> visitor's browser** — there is no way to hide it, and that's by design for the Maps JS
> API. Anyone can open DevTools and read it. **An unrestricted key is a blank cheque
> against your credit card:** scrapers harvest exposed Maps keys and run up thousands of
> dollars in billing on *your* account.
>
> **Before you deploy anywhere public, you MUST lock the key down in the
> [Google Cloud console](https://console.cloud.google.com/google/maps-apis/credentials):**
>
> 1. **Application restriction → HTTP referrers (web sites).** Add *only* the domains that
>    are allowed to use the key, e.g.:
>    - `https://worldseek.yourdomain.com/*`
>    - `http://localhost:3000/*` (for local dev)
> 2. **API restriction → Restrict key** and enable *only* **Maps JavaScript API**.
> 3. **Set a billing budget + alert** (Billing → Budgets & alerts) so a leak can't run
>    unbounded — e.g. alert at $10/$50.
>
> ✅ With HTTP-referrer restriction in place, a stolen key is useless on any other domain.
> ❌ Without it, assume the key **will** be abused. Never commit a real key — `.env*` is
> gitignored (only `.env.example`, a placeholder, is tracked).

## 🏃 Run (development)

```bash
npm run dev
# → World Seek ready on http://localhost:3000
```

The `dev` script runs the **custom server** (`server/index.ts`) via `tsx watch`, which serves
both Next.js and the Socket.IO endpoint on the same port.

### Windows launchers

After completing Setup above, you can start the game by double-clicking `run_game.bat`.
It starts the server locally at `http://localhost:3000` and also starts an Ngrok tunnel.
The shared launcher never contains a contributor's personal domain.

To let people outside your local network join, install and configure [Ngrok](https://ngrok.com/)
with your own account. For a reserved domain, set `NGROK_DOMAIN` in the terminal before starting
the launcher:

```bat
set NGROK_DOMAIN=YOUR_NGROK_DOMAIN
run_game.bat
```

Replace `YOUR_NGROK_DOMAIN` with the domain assigned to your Ngrok account. The launcher then
opens that URL in Chrome. Without `NGROK_DOMAIN`, it starts a temporary Ngrok URL and prints the
address in the Ngrok window; open that address manually. A personal `run_game.local.bat` can
still be used for convenience, but it is gitignored so personal tunnel addresses are not
committed or pushed. For Maps to work for remote players, also allow your Ngrok HTTPS domain in
the Google Maps API key's HTTP referrer restrictions in Google Cloud.

## 🚀 Production (plain Node)

```bash
npm run build
npm start
```

## 🐳 Deploy with Docker

The repo ships a multi-stage `Dockerfile` and `.dockerignore`. It can run anywhere that can
build a Dockerfile, including a VPS, Docker Compose, Kubernetes, or a Docker-based PaaS.

> ### ⚠️ The one thing you can't get wrong: the Maps key is a **build arg**
>
> `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is inlined into the **browser bundle** during `next build`,
> so it must be passed at **build time** (`--build-arg`), not just as a runtime env var. Pass it
> only at runtime and Maps/Street View will not initialize correctly. The TURN variables are
> also `NEXT_PUBLIC_*` settings and must be passed at build time. `ALLOWED_ORIGIN`, `PORT`,
> `MAPS_BUDGET_USD`, and `BUDGET_STATE_PATH` are runtime settings.

### Build & run directly

```bash
# Build — the Maps key MUST be a --build-arg (baked into the client bundle)
docker build \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key \
  --build-arg NEXT_PUBLIC_TURN_URL=turn:turn.yourdomain.com:3478 \
  --build-arg NEXT_PUBLIC_TURN_USERNAME=your-username \
  --build-arg NEXT_PUBLIC_TURN_CREDENTIAL=client-safe-credential \
  -t world-seek .

# Run — keep /data on a persistent volume to preserve the budget counter.
docker run -p 3000:3000 \
  -e ALLOWED_ORIGIN=https://worldseek.yourdomain.com \
  -e MAPS_BUDGET_USD=0 \
  -v world-seek-data:/data \
  world-seek
```

The TURN build args are optional; omit them to use the public fallback TURN service.

### Or with Docker Compose

A [`compose.yaml`](compose.yaml) is included. It already declares the named volume the
[Maps usage counter](#-approximate-google-maps-usage-budget) needs. Copy `.env.example` to `.env.local`,
set the Maps key, and run:

```sh
docker compose --env-file .env.local up --build
```

Compose passes the Maps and optional TURN settings as build args, and the budget/origin/port
settings at runtime. The bundled compose file publishes port 3000 by default; set `PORT` in
`.env.local` to use a different host and container port.

### Environment variables

| Variable | When | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | **build** | ✅ | Maps + Street View; inlined into the client bundle |
| `ALLOWED_ORIGIN` | runtime | **production** | Your public `https://…` origin; restricts Socket.IO CORS. If unset, Socket.IO accepts requests from any origin. |
| `PORT` | runtime | — | Listen port (defaults to `3000`) |
| `NEXT_PUBLIC_TURN_URL` | **build** | — | Your own TURN server URL (e.g. `turn:turn.yourdomain.com:3478`); see [Voice chat & TURN](#-voice-chat--turn) below |
| `NEXT_PUBLIC_TURN_USERNAME` | **build** | — | TURN credential username, paired with `NEXT_PUBLIC_TURN_URL` |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | **build** | — | TURN credential passed to clients; do not use a secret that must remain private |
| `MAPS_BUDGET_USD` | runtime | — | Approximate monthly admission budget in USD (defaults to `0`, allowing only the configured base allowance); see [Approximate Google Maps usage budget](#-approximate-google-maps-usage-budget) |
| `BUDGET_STATE_PATH` | runtime | — | Where the budget counter is stored (defaults to `/data/budget.json`) |

### 💸 Approximate Google Maps usage budget

Google's actual charges depend on the APIs/SKUs used, the project's billing terms, and current
Google Maps Platform pricing. The server-side meter is only an **approximate admission guard**;
it is not a Google Cloud billing cap, does not measure actual API requests, and cannot guarantee
that your bill stays under a specific amount. Check your Google Cloud billing reports and set
budgets/alerts and API quotas there as well.

When a game starts, the server charges a conservative allowance against a monthly counter:

- Multiplayer: 150 map-load units and 75 Street View panorama units per connected player.
- Solo: 2 map-load units and 1 panorama unit per round.

These are the server's configured accounting units, not a promise that each player actually
generates exactly that many billable requests. The meter uses the pricing assumptions in
`src/server-logic/budget.ts` to split `MAPS_BUDGET_USD` evenly between its map and panorama
ceilings. It currently assumes 10,000 map units and 5,000 panorama units before paid usage;
Google's free allowances and prices can change, so verify current terms independently. The
default budget is `$0`, allowing admission only within those configured base allowances.

If the counter cannot afford another game, the home page shows a closed-budget message and
the server refuses new rooms or game starts. The counter rolls over on the first day of each
UTC month. `GET /api/budget` returns the local counter, its ceilings, the configured budget,
and the estimated number of multiplayer player-games remaining:

```bash
curl https://worldseek.yourdomain.com/api/budget
```

> **The local admission counter needs persistent storage**, or it resets on every redeploy.
> The included Docker Compose setup mounts a named volume at `/data`. For a direct Docker
> deployment, mount a persistent volume at `/data` yourself. The image creates that directory
> and grants its unprivileged runtime user write access, but the volume must be managed by the
> host/platform and must not be removed during redeploys.
>
> On startup, the server also tries to query actual request counts from Google Cloud Monitoring
> for the Google Cloud project `worldseek` and prints them:
>
> ```
> [budget] 2026-10: 4230/10000 map loads, 2115/5000 panoramas — 38 player-games left
> ```
>
> This informational query requires the `gcloud` CLI, credentials with access to Cloud
> Monitoring, and the Monitoring API enabled for that project. The Docker image does not include
> `gcloud`, so it logs a warning and continues unless you add/configure it. If the query fails,
> game admission still uses the local counter. These Cloud Monitoring results do not update or
> validate that counter.

#### Installing and configuring `gcloud` (optional)

The usage query is optional. On Windows, install the Google Cloud CLI from
[the official installation guide](https://cloud.google.com/sdk/docs/install) or with
`winget`:

```powershell
winget install Google.CloudSDK
```

Open a new terminal after installation, then sign in and select the project used by World Seek:

```powershell
gcloud init
gcloud auth application-default login
gcloud config set project worldseek
gcloud services enable monitoring.googleapis.com
gcloud auth print-access-token
```

The last command should print an access token. The account must have permission to read Cloud
Monitoring metrics for the `worldseek` project (for example, the **Monitoring Viewer** role).
After installing the CLI, close and reopen the terminal (and restart VS Code if the server is
started from its integrated terminal) so the updated `PATH` is available. Then restart the World
Seek server. If `gcloud` is not installed or
authentication fails, the server continues to use the local budget counter and skips the
informational Cloud Monitoring query.

The counter is charged in full when a game starts, including games that are abandoned. Review
Google Cloud's actual usage and billing reports regularly; the usage query is informational and
the local counter is not a substitute for a billing budget or quota.

### 🎙️ Voice chat & TURN

Voice is peer-to-peer WebRTC, so two players behind certain routers/NATs (symmetric NAT,
some hotel/corporate Wi-Fi) can't connect directly — they need a **TURN** server to relay
audio. If you leave `NEXT_PUBLIC_TURN_*` unset, World Seek falls back to the free
[Open Relay Project](https://www.metered.ca/tools/openrelay/) public TURN server, which is
fine for trying things out but is shared, rate-limited, and not something to depend on for a
real deployment. For anything beyond casual local play, run your own TURN server (e.g.
[coturn](https://github.com/coturn/coturn)) and set the three `NEXT_PUBLIC_TURN_*` build args
above. These values are inlined into the client bundle and visible to every player; use
client-safe or short-lived TURN credentials, not a private server password.

> ### 🚦 Keep it to one instance
> All your games live in the server's memory, like notes on a whiteboard — there's no separate
> database backing it up. That's totally fine for friends playing together, but it means:
>
> - **Don't turn on autoscaling / multiple replicas.** If your host spins up a second copy of
>   the server, it's a second blank whiteboard — some players could get routed to a copy that's
>   never heard of your game and get bumped out. Just run **one** instance.
> - **A restart wipes active games.** If the server reboots or redeploys mid-game, that
>   whiteboard gets wiped — everyone would need to start a fresh game. No big deal for casual
>   play, just don't expect it to survive a deploy.
>
> Also put a reverse proxy (Caddy, Traefik, nginx) in front for HTTPS, and make sure it allows
> WebSocket upgrades — that's what keeps everyone's connection (and voice/text chat) alive.

### On a PaaS (Coolify, Render, Railway, …)

Point it at the repo, set **Build Pack / builder = Dockerfile**, expose port **3000**, and set
the variables above — crucially, mark `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` as a **build-time / build
variable** (not runtime-only). Most platforms terminate HTTPS and handle WebSocket upgrades for
you. Keep it to a single instance.

> 🔐 **Don't forget to restrict the Maps key** in the Google Cloud console before exposing it —
> HTTP-referrer restriction for your domain, scope it to the Maps JavaScript API, and set a
> billing budget alert. See [Setup → step 2](#️-setup).

## 🎮 How to play

1. 🏠 Open `http://localhost:3000`, enter a name, and choose **Start game** to create a room.
   You're the host (GM).
2. 🔗 Share the URL (e.g. `http://localhost:3000/game/abr-tyr`). Each person opens it and picks
   a name; they appear in your lobby live.
3. 🎚️ As host, configure the number of cycles and optional phase time limits, then start.
   A solo game can start with one player; multiplayer needs at least two.
4. 🙈 **Hiding (multiplayer):** everyone drops a pin and confirms with **Hide here** (only spots
   with Street View coverage are allowed; the host can optionally allow unofficial coverage).
   Solo games skip this phase and use game-selected locations.
5. 🔍 **Finding:** in multiplayer, one hider is the target while the other players guess; the
   target sits out their own round. In solo mode, the player guesses the game-selected location.
6. 🎊 **Results:** the real spot, all guesses, and points are revealed. Host advances.
7. 🥇 After the last round, final scores + winner. Host can return everyone to the lobby.

### 💬🎙️ Chat & voice

- The host toggles **text chat** and **voice chat** on or off per game when creating it.
- Text chat is a shared room thread (open it from the in-game chat panel) with per-game
  history sent to anyone who (re)joins.
- Voice chat connects every player directly to every other player (mesh WebRTC). Audio does
  not pass through the World Seek app server, though it may be relayed through a TURN server.
  Pick **always-on**, **push-to-talk** (hold Space), or **mute**, and choose your mic from the
  device picker in voice settings.

### 🔄 Reconnection & join-locking

- A session token is stored in `localStorage` per game. Refresh or reconnect mid-game and you
  drop back into your seat.
- New players **cannot join once the game has started** — only reconnections with a valid
  token are honored.

## 🗂️ Project layout

```
server/                 custom Node server (Next + Socket.IO) and event handlers
src/shared/             types, scoring (haversine + decay), code/token generation — shared
src/server-logic/       in-memory store, state-machine transitions, per-player projection
src/lib/                client socket, session storage, useGame hook, Google Maps loader,
                        useTextChat / useVoiceChat hooks
src/components/         MapPicker, StreetView, the phase screens, TextChat, VoiceChat,
                        VoiceSettings
src/app/                home page + /game/[code] room shell
scripts/smoke.mjs       headless end-to-end test of the full game loop (server must be running)
scripts/load.mjs        Socket.IO load harness for concurrent rooms (server must be running)
scripts/multiplayer-capacity.mjs
                        multiplayer capacity benchmark
```

## 🧪 Testing the game logic without a browser

With the dev server running:

```bash
node scripts/smoke.mjs
```

This drives three simulated players through create → join → start → hide → guess → results →
finish → reconnect, asserting the server's behavior (no Maps key needed).

## ⚠️ Known limitations (MVP)

- 💾 Active room/game state is in-memory — a server restart drops live games. The Maps admission
  counter is separate and can persist in the `/data` volume.
- 🛡️ Anti-cheat is panoId-based (the hider's coords aren't sent to guessers until the reveal),
  which is friendly-game grade, not bulletproof.
- ⏱️ Hiding and finding timers are optional and default to unlimited. Without a timer, phases
  advance when everyone has acted; the host can also advance from results.

## 📜 License

The **code** is released under the [MIT License](LICENSE) — free to use, modify, and distribute.

**Bundled assets (not MIT):**

- 🙂 The emoji avatars in [`public/emojis/`](public/emojis/) are from
  [**OpenMoji**](https://openmoji.org) and are licensed
  [**CC-BY-SA 4.0**](https://creativecommons.org/licenses/by-sa/4.0/). If you redistribute
  them you must keep this attribution and share any modifications under the same license.
  Swap them out (see [`src/shared/emojis.ts`](src/shared/emojis.ts)) if you'd rather not
  carry the share-alike terms.

> ℹ️ The MIT license covers this project's own code, not the third-party assets above and
> not the **Google Maps + Street View** platform, which World Seek relies on at runtime.
> Google Maps is a proprietary service governed by the
> [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms);
> anyone running World Seek must supply their own (restricted — see
> [Setup](#️-setup)) API key and accept Google's terms. The MIT license grants no rights
> to that service.
