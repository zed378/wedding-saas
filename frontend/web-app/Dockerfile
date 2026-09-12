# The authenticated application. Built from the REPOSITORY ROOT:
#   docker build -f frontend/web-app/Dockerfile .
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
# Where the browser will find the API.
#
# A BUILD argument, not a runtime variable, and that is not a preference: `NEXT_PUBLIC_*`
# is read in client components, so Next **inlines its value into the bundle** during
# `next build`. Setting it on the container at run time changes nothing -- the string is
# already baked into the JavaScript the browser downloads.
#
# The default is the local stack's API. Without it every deployed build would ship
# `http://localhost:3000/api/v1`, which resolves to the VISITOR's own machine: the login
# form would fail with a connection error on a server that is running perfectly.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN pnpm install --prefer-offline --frozen-lockfile \
 && pnpm --filter @wi/web-app... build

# ---------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `output: "standalone"` produced a tree that already contains the server and only the
# node_modules it actually reaches. Three copies rather than one because Next splits the
# output: the server, the hashed build assets, and anything under public/.
COPY --from=build --chown=node:node /repo/frontend/web-app/.next/standalone ./
COPY --from=build --chown=node:node /repo/frontend/web-app/.next/static ./frontend/web-app/.next/static

USER node
EXPOSE 3100
ENV PORT=3100 HOSTNAME=0.0.0.0

# The standalone server, at the path the tracing root put it. Not `next start` -- that
# would need the full Next CLI and the whole dependency tree back again.
CMD ["node", "frontend/web-app/server.js"]
