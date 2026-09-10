# Multi-stage build for the API (docs/DEVOPS/02-CONTAINERIZATION.md).
#
# Built from the repository root so the workspace is available:
#   docker build -f backend/api/Dockerfile .
#
# `pnpm deploy` produces a self-contained directory with the workspace dependency
# symlinks resolved into real files, which is what makes the runtime stage able to drop
# the pnpm store, the other surfaces and every dev dependency.
#
# `--legacy` because pnpm 10+ otherwise requires `inject-workspace-packages=true` on the
# workspace. Injection would copy workspace packages into their consumers during ordinary
# local installs too, which trades a stale-copy failure mode in development for a flag
# here. The flag is the smaller cost.

# ---------------------------------------------------------------- base
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------- dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/api/package.json backend/api/
COPY backend/worker/package.json backend/worker/
COPY frontend/web-app/package.json frontend/web-app/
COPY frontend/public-invite/package.json frontend/public-invite/
COPY admin/package.json admin/
COPY packages/schema/package.json packages/schema/
COPY packages/template-renderer/package.json packages/template-renderer/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY backend/api/ backend/api/
RUN pnpm --filter @wi/schema build \
 && pnpm --filter @wi/api build \
 && pnpm --filter @wi/api --prod --legacy deploy /out

# ---------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root (docs/DEVOPS/02 § Container Security Principles). The node image already
# ships an unprivileged `node` user; creating another would add nothing.
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json

USER node
EXPOSE 3000

# The healthcheck runs the app's own runtime rather than adding curl to the image:
# fewer packages in the runtime layer is fewer things to patch.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
