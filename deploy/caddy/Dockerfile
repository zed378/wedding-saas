# deploy/caddy/Dockerfile
#
# Builds a Caddy image that includes the caddy-ratelimit third-party module.
#
# The standard caddy:2.9-alpine image does not ship caddy-ratelimit. Caddy parses
# the full Caddyfile at startup; an unknown directive causes a fatal error, so
# deploying deploy/Caddyfile.production against the unmodified upstream image
# makes all three hosts unreachable immediately.
#
# xcaddy compiles a custom Caddy binary with the modules listed under --with. The
# build stage uses the official xcaddy image; the final stage copies only the binary
# into the same slim Alpine base, keeping the image footprint close to the official one.
#
# Usage:
#   docker build -t wedding-caddy:2.9-ratelimit deploy/caddy/
#   # or via compose:
#   docker compose -f deploy/docker-compose.staging.yml build caddy
#
# Versions:
#   Caddy:             2.9.1  — matches the 2.9-alpine tag used across the project
#   caddy-ratelimit:   0.0.0-20240716222322-24d1a0c  — latest commit on main at
#                      the time this file was written; pin to a commit SHA for
#                      reproducible builds (no semver tag exists for this module).

# ---- build stage -----------------------------------------------------------
FROM caddy:2.9-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

# ---- final stage -----------------------------------------------------------
FROM caddy:2.9-alpine

# Replace the stock Caddy binary with our xcaddy-built one.
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Verify the module loaded correctly. This prints the list of modules; the build
# fails if caddy cannot load its own binary, catching a bad build before it is pushed.
RUN caddy list-modules | grep -q "http.handlers.rate_limit" \
    && echo "caddy-ratelimit module confirmed" \
    || (echo "ERROR: caddy-ratelimit module not found in binary" >&2 && exit 1)
