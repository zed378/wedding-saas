# The admin panel. A static SPA (ADR-009: no SSR behind authentication), so the runtime
# is a web server and nothing else -- no Node, no dependencies, nothing to patch.
#
# Built from the REPOSITORY ROOT:
#   docker build -f admin/Dockerfile .

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --prefer-offline --frozen-lockfile \
 && pnpm --filter @wi/admin... build

# ---------------------------------------------------------------- runtime
FROM nginx:1.29-alpine AS runtime

COPY --from=build /repo/admin/dist /usr/share/nginx/html
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
