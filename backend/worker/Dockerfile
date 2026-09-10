# Multi-stage. Same shape as backend/api/Dockerfile -- build with the workspace, ship a
# runtime with no package manager, no source and no dev dependencies.
#
# Build from the REPOSITORY ROOT, because the build needs the pnpm workspace:
#   docker build -f backend/worker/Dockerfile -t wi-worker .
#
# .dockerignore lives at the context root, which is the only place Docker reads it. A
# copy next to this file is silently ignored -- see the P0-05 record.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY backend/worker ./backend/worker

RUN pnpm install --frozen-lockfile
# `@wi/worker...` -- the trailing dots mean "and everything it depends on". Without them
# only the worker itself is built and its workspace dependencies have no `dist/`, which
# `P0-19.1` hit the moment the worker gained its first type-level workspace import:
#   src/logger.ts(2,30): error TS2307: Cannot find module '@wi/logging'
# The API image had the same latent bug and the same fix.
RUN pnpm --filter @wi/worker... build
RUN pnpm --filter @wi/worker --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/worker/dist ./dist

USER node

# No HEALTHCHECK. A worker serves no port, and a healthcheck that shells out on an
# interval is a process spawn per check for no signal. Liveness for the worker is the
# queue draining, which docs/DEVOPS/07 alerts on from the outside.
#
# The pool is required and has no default -- a worker that guessed would either leave
# media unprocessed or run cron three times.
ENTRYPOINT ["node", "dist/main.js"]
CMD ["--pool", "general"]
