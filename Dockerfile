# ---- base ----
FROM node:20-bookworm-slim AS base
WORKDIR /app

# ---- build (installs all deps, runs next build) ----
FROM base AS build
# Leave NODE_ENV unset so `npm ci` installs devDependencies (tsx, next, typescript)
# AND `next build` runs under its production runtime.
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle at build time -> must be a build arg,
# NOT a runtime-only env var. Pass it with `docker build --build-arg NEXT_PUBLIC_...=...`
# (most PaaS platforms expose this as a "build-time" / "build" variable).
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_TURN_URL
ARG NEXT_PUBLIC_TURN_USERNAME
ARG NEXT_PUBLIC_TURN_CREDENTIAL
ENV NEXT_PUBLIC_TURN_URL=$NEXT_PUBLIC_TURN_URL
ENV NEXT_PUBLIC_TURN_USERNAME=$NEXT_PUBLIC_TURN_USERNAME
ENV NEXT_PUBLIC_TURN_CREDENTIAL=$NEXT_PUBLIC_TURN_CREDENTIAL
RUN npm run build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
RUN useradd -m -u 1001 appuser
# Maps-budget counter lives here (BUDGET_STATE_PATH, default /data/budget.json).
# Created and chowned up front so a volume mounted at /data is writable by the
# unprivileged runtime user — otherwise the counter falls back to memory-only
# and resets on every redeploy.
#
# Deliberately NOT a `VOLUME` instruction: that creates an *anonymous* volume,
# which a redeploy replaces with an empty one — persistence that looks real and
# isn't. Mount a named volume here instead (see compose.yaml) and keep it mounted
# across redeploys to preserve the local game-admission counter.
RUN mkdir -p /data && chown appuser:appuser /data
# Full node_modules kept on purpose: `npm start` -> `tsx server/index.ts` needs tsx,
# cross-env, next and the TS source (server/, src/) at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/tsconfig.json ./tsconfig.json
USER appuser
EXPOSE 3000
CMD ["npm", "start"]
