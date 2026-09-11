# The public invitation renderer, server-rendered (docs/FRONTEND/07). Built from the REPOSITORY ROOT:
#   docker build -f frontend/public-invite/Dockerfile .
#
# Same shape as backend/api/Dockerfile and for the same reasons -- see the long note
# there about `pnpm fetch` keying the dependency layer on the lockfile alone, which is
# why there is no hand-maintained list of workspace manifests in either file.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------- dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# ---------------------------------------------------------------- build
FROM deps AS build
COPY . .
RUN pnpm install --prefer-offline --frozen-lockfile \
 && pnpm --filter @wi/public-invite... build

# ---------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `output: "standalone"` produced a tree that already contains the server and only the
# node_modules it actually reaches. Three copies rather than one because Next splits the
# output: the server, the hashed build assets, and anything under public/.
COPY --from=build --chown=node:node /repo/frontend/public-invite/.next/standalone ./
COPY --from=build --chown=node:node /repo/frontend/public-invite/.next/static ./frontend/public-invite/.next/static

USER node
EXPOSE 3200
ENV PORT=3200 HOSTNAME=0.0.0.0

# The standalone server, at the path the tracing root put it. Not `next start` -- that
# would need the full Next CLI and the whole dependency tree back again.
CMD ["node", "frontend/public-invite/server.js"]
