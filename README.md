# 🌍 World Seek

🎉 A multiplayer hide-and-seek geo-guessing party game! 🕵️ Each player secretly drops a pin 📍
somewhere in the world (their hiding spot), then everyone takes turns guessing where each
player is hiding using Google Street View. 🏆 Points are awarded by distance — closest wins!

▶️ **[Watch here for game walkthough](https://youtu.be/eQZJzsQGTDQ)**


## 🧰 Stack

- ⚡ **Next.js 14** (App Router) for the client
- 🔌 **Socket.IO** on a **custom Node server** that holds all room state in memory and is the
  single source of truth (clients send intents; the server runs the game and pushes a
  redacted per-player state)
- 🗺️ **Google Maps + Street View** for hiding and guessing
- 💬 **Text chat** over Socket.IO, scoped per game
- 🎙️ **Live voice chat** over peer-to-peer **WebRTC** (mesh of direct connections between
  players) — always-on, push-to-talk, or mute, with a mic device picker and a speaking
  indicator. Socket.IO only carries signaling (offers/answers/ICE candidates); audio never
  touches the server

## ✅ Prerequisites

- 🟢 Node.js 18+ (this repo was verified on Node 24)
- 🔑 A **Google Maps JavaScript API key** with **Maps JavaScript API** and **Street View**
  enabled and **billing on** (in the [Google Cloud console](https://console.cloud.google.com/)).

## ⚙️ Setup

**1. Install dependencies and create your env file**

```bash
npm install
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

## 🚀 Production (plain Node)

```bash
npm run build
npm start
```

## 🐳 Deploy with Docker

The repo ships a standard multi-stage `Dockerfile` and `.dockerignore` — no platform-specific
config. It runs on anything that builds a Dockerfile: a bare VPS, `docker compose`, Kubernetes,
or a PaaS (Coolify, Render, Railway, Fly, Cloud Run, …).

> ### ⚠️ The one thing you can't get wrong: the Maps key is a **build arg**
>
> `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is inlined into the **browser bundle** during `next build`,
> so it must be passed at **build time** (`--build-arg`), not just as a runtime env var. Pass it
> only at runtime and **Street View silently fails** with no obvious error. The other variables
> (`ALLOWED_ORIGIN`, `PORT`) are runtime-only.

### Build & run directly

```bash
# Build — the Maps key MUST be a --build-arg (baked into the client bundle)
docker build \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key \
  -t world-seek .

# Run — ALLOWED_ORIGIN and PORT are runtime env vars
docker run -p 3000:3000 \
  -e ALLOWED_ORIGIN=https://worldseek.yourdomain.com \
  world-seek
```

### Or with `docker compose`

A [`compose.yaml`](compose.yaml) is included. It already declares the named volume the
[Maps budget cap](#-capping-your-maps-bill) needs, so nothing extra to wire up:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key \
ALLOWED_ORIGIN=https://worldseek.yourdomain.com \
docker compose up --build
```

### Environment variables

| Variable | When | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | **build** | ✅ | Maps + Street View; inlined into the client bundle |
| `ALLOWED_ORIGIN` | runtime | prod | Your `https://…` origin; locks Socket.IO CORS |
| `PORT` | runtime | — | Listen port (defaults to `3000`) |
| `NEXT_PUBLIC_TURN_URL` | **build** | — | Your own TURN server URL (e.g. `turn:turn.yourdomain.com:3478`); see [Voice chat & TURN](#-voice-chat--turn) below |
| `NEXT_PUBLIC_TURN_USERNAME` | **build** | — | TURN credential username, paired with `NEXT_PUBLIC_TURN_URL` |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | **build** | — | TURN credential password, paired with `NEXT_PUBLIC_TURN_URL` |
| `MAPS_BUDGET_USD` | runtime | — | Monthly Google Maps spend cap in USD (defaults to `20`); see [Capping your Maps bill](#-capping-your-maps-bill) |
| `BUDGET_STATE_PATH` | runtime | — | Where the budget counter is stored (defaults to `/data/budget.json`) |

### 💸 Capping your Maps bill

Every map and Street View panorama the game draws is a **billed Google API call**, so the cost
scales with how much people play. Roughly:

| | Dynamic Maps | Dynamic Street View | Cost |
|---|---|---|---|
| One player, one full game | ~30 loads | ~15 panoramas | **~$0.42** |
| A 10-person game, all rounds | ~300 | ~150 | **~$4.20** |
| One solo session (5 rounds) | ~10 | ~5 | **~$0.14** |

Google gives you 10,000 free map loads and 5,000 free panoramas a month — about **330
player-games** — and charges $7 and $14 per 1,000 after that.

So the server meters itself. Each game start charges the connected player count against a
monthly budget (`MAPS_BUDGET_USD`, default `$20` ≈ 380 player-games — 38 ten-person games, or
190 two-player ones, or any mix). When it runs out the site closes with a page explaining why
and pointing at this repo, and the counter resets on the 1st. `GET /api/budget` reports where
you are:

```bash
curl https://worldseek.yourdomain.com/api/budget
# {"period":"2026-07","mapLoads":4230,"panoLoads":2115,...,"playerGamesLeft":239}
```

> **The local admission counter needs a persistent volume**, or it resets on every redeploy —
> i.e. the cap stops working exactly when you're relying on it. With `docker compose` this is
> already handled.
> Deploying straight from the Dockerfile (including most PaaS setups), mount a volume at `/data`
> yourself — the image creates the directory owned by the runtime user, but only your host can
> make it outlive the container.
>
> On every boot the server queries Google Cloud Monitoring for the current month's actual
> request counts and prints the free-tier usage:
>
> ```
> [budget] 2026-10: 4230/10000 map loads, 2115/5000 panoramas — 38 player-games left
> ```
>
> The startup query requires `gcloud auth print-access-token` to work in the server environment.
> If gcloud or the network is unavailable, the server prints a warning and continues. The local
> admission counter is still exposed by `GET /api/budget`; the startup metrics don't reflect its
> persistence status.

The per-game numbers above are estimates — how much players wander in Street View moves them,
and abandoned games get charged in full at start. Expect ±30%. Compare `/api/budget` against
the Cloud console's Dynamic Maps / Dynamic Street View metrics after a few weeks and tune the
constants at the top of `src/server-logic/budget.ts`. It's also worth setting a **`Map loads per
day` quota** (~380) on the Maps JavaScript API in Google Cloud as a hard backstop underneath
this — note that Google exposes no equivalent quota for Street View panoramas, which is half
the reason this app-level meter exists.

### 🎙️ Voice chat & TURN

Voice is peer-to-peer WebRTC, so two players behind certain routers/NATs (symmetric NAT,
some hotel/corporate Wi-Fi) can't connect directly — they need a **TURN** server to relay
audio. If you leave `NEXT_PUBLIC_TURN_*` unset, World Seek falls back to the free
[Open Relay Project](https://www.metered.ca/tools/openrelay/) public TURN server, which is
fine for trying things out but is shared, rate-limited, and not something to depend on for a
real deployment. For anything beyond casual local play, run your own TURN server (e.g.
[coturn](https://github.com/coturn/coturn)) and set the three `NEXT_PUBLIC_TURN_*` build args
above. Like the Maps key, these are `NEXT_PUBLIC_` and inlined into the client bundle, so set
them at **build time**.

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

1. 🏠 Open `http://localhost:3000`, enter a name, and **Start game**. You're the host (GM).
2. 🔗 Share the URL (e.g. `http://localhost:3000/game/abr-tyr`). Each person opens it and picks
   a name; they appear in your lobby live.
3. 🎚️ As host, pick a difficulty and **Start game** (needs ≥2 players).
4. 🙈 **Hiding:** everyone drops a pin and confirms with **Hide here** (only spots with Street
   View coverage are allowed).
5. 🔍 **Finding:** one hider at a time — everyone else sees that hider's Street View and drops a
   guess. The hider sits out their own round.
6. 🎊 **Results:** the real spot, all guesses, and points are revealed. Host advances.
7. 🥇 After the last round, final scores + winner. Host can return everyone to the lobby.

### 💬🎙️ Chat & voice

- The host toggles **text chat** and **voice chat** on or off per game when creating it.
- Text chat is a shared room thread (open it from the in-game chat panel) with per-game
  history sent to anyone who (re)joins.
- Voice chat connects every player directly to every other player (mesh WebRTC) — no audio
  passes through the server. Pick **always-on**, **push-to-talk** (hold Space), or **mute**,
  and choose your mic from the device picker in voice settings.

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
```

## 🧪 Testing the game logic without a browser

With the dev server running:

```bash
node scripts/smoke.mjs
```

This drives three simulated players through create → join → start → hide → guess → results →
finish → reconnect, asserting the server's behavior (no Maps key needed).

## ⚠️ Known limitations (MVP)

- 💾 Room state is in-memory — a server restart drops live games.
- 🛡️ Anti-cheat is panoId-based (the hider's coords aren't sent to guessers until the reveal),
  which is friendly-game grade, not bulletproof.
- ⏱️ No per-phase timers — phases advance when everyone has acted, with a host "skip the wait"
  override.

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
