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
# `pnpm fetch` populates the store from the LOCKFILE ALONE -- it reads no package.json at
# all. That is the entire reason it is used here.
#
# This stage used to `COPY` every workspace member's package.json by hand so the layer
# would cache on manifests. `P0-19` found that list two members stale (`packages/storage`
# and `e2e`), and the failure was silent: the image built, and served whatever the cache
# had last produced. `P0-19.1` needed to add a third (`packages/logging`) and instead
# removed the list, because a hand-maintained inventory of the workspace is a mechanism
# that fails quietly every time someone adds a package.
#
# The trade is real and worth stating: the cache key is now the lockfile, so adding any
# dependency anywhere re-fetches. Adding a dependency is rare; forgetting a package is not.
FROM base AS deps
# `pnpm-workspace.yaml` comes along because it carries the `onlyBuiltDependencies`
# allowlist. Without it `pnpm fetch` refuses with ERR_PNPM_IGNORED_BUILDS rather than
# silently skipping native postinstalls, which is the correct behaviour and the reason
# the decision has to travel with the lockfile. It is a root file listing globs, not
# members, so it cannot go stale the way the manifest list did.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# ---------------------------------------------------------------- build
# `--prefer-offline`, not `--offline`. `--offline` was tried first because it would prove
# the fetch layer complete -- and it fails: pnpm 11 verifies the lockfile against its
# supply-chain policies on every install, and that check reads registry metadata that
# `pnpm fetch` does not mirror. Package tarballs still come from the warm store; what
# crosses the network is metadata. Stated rather than hidden, because "offline" would
# have been the stronger claim and this is not it.
#
# `--filter @wi/api...` (with the trailing dots) means "@wi/api and everything it depends
# on", so the build order comes from the dependency graph rather than a second hand-kept
# list that could go stale the same way the first one did.
FROM deps AS build
COPY . .
RUN pnpm install --prefer-offline --frozen-lockfile \
 && pnpm --filter @wi/api... build \
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
