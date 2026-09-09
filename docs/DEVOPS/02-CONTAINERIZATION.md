# 02 - Containerization

## Principle
- All services (Backend API, Frontend SSR, Worker, Admin Panel) are containerized with a multi-stage Dockerfile (a separate build stage from the runtime stage) to keep the image as small as possible and avoid including build tools in the production image.

## Example Dockerfile Structure (indicative, Node.js)
```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## Container Security Principles
- Run as a non-root user (`USER node`).
- An official & minimal base image (alpine/distroless), periodically scanned for image vulnerabilities.
- No secrets included in the image (environment variables are injected at runtime by the orchestrator, not via `COPY .env`).

## docker-compose (Local Development)
```yaml
services:
  api:
    build: ./apps/api
    env_file: .env.development
    depends_on: [postgres, redis]
  worker:
    build: ./apps/worker
    env_file: .env.development
    depends_on: [postgres, redis]
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_PASSWORD: dev }
  redis:
    image: redis:7-alpine
  minio: # local object storage to simulate S3
    image: minio/minio
```

## Production Orchestration
- Kubernetes OR a managed container platform (e.g., ECS, Cloud Run) — the choice depends on the team's scale & budget; the principles of health-checking, resource limits, and autoscaling (ARCHITECTURE/08) apply to both options.
