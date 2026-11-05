# syntax=docker/dockerfile:1
# Stage 1: TypeScript compilation with dev tooling (excluded from final image).
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ARG SERVICE=api
RUN case "$SERVICE" in api|worker) pnpm --filter "@xiaohai/$SERVICE..." build ;; *) echo 'invalid SERVICE' >&2; exit 2 ;; esac
# Worker does not depend on domain, but both image variants share a safe
# explicit workspace build output manifest for the production dependency stage.
RUN pnpm --filter @xiaohai/domain build

# Stage 2: reconstruct the real pnpm workspace symlinks using production ONLY
# dependencies, instead of copying broken legacy-deploy workspace links.
FROM node:22-bookworm-slim AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/validation/package.json packages/validation/package.json
ARG SERVICE=api
RUN case "$SERVICE" in api|worker) pnpm --filter "@xiaohai/$SERVICE..." install --prod --frozen-lockfile ;; *) exit 2 ;; esac
COPY --from=builder /workspace/packages/config/dist /app/packages/config/dist
COPY --from=builder /workspace/packages/contracts/dist /app/packages/contracts/dist
COPY --from=builder /workspace/packages/db/dist /app/packages/db/dist
COPY --from=builder /workspace/packages/domain/dist /app/packages/domain/dist
COPY --from=builder /workspace/packages/validation/dist /app/packages/validation/dist
COPY --from=builder /workspace/packages/db/migrations /app/packages/db/dist/migrations
COPY --from=builder /workspace/apps/${SERVICE}/dist /app/apps/${SERVICE}/dist
RUN test -f /app/packages/db/dist/src/index.js && test -f /app/packages/db/dist/migrations/meta/_journal.json

# Stage 3: only production module graph, compiled files and migration journal.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG SERVICE=api
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
COPY --from=production /app /app
CMD ["sh", "-c", "if [ \"$SERVICE_NAME\" = worker ]; then exec node apps/worker/dist/index.js; else exec node apps/api/dist/server.js; fi"]
