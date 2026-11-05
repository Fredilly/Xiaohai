# syntax=docker/dockerfile:1
# Build TypeScript with full dev dependencies, package only the selected service.
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ARG SERVICE=api
RUN case "$SERVICE" in api|worker) pnpm --filter "@xiaohai/$SERVICE..." build ;; *) echo 'invalid SERVICE' >&2; exit 2 ;; esac
# DB migrations are runtime assets, not automatically copied by tsc.
RUN mkdir -p packages/db/dist/migrations && cp -a packages/db/migrations/. packages/db/dist/migrations/
# Legacy mode is necessary for this pnpm 11 workspace without injected packages.
RUN pnpm --filter "@xiaohai/$SERVICE" --prod deploy --legacy /runtime
# Deploy packlists can exclude dist via the repository .gitignore. Recopy ONLY
# compiled workspace files; never copy development dependencies to runtime.
RUN set -eu; \
    cp -a "apps/$SERVICE/dist" /runtime/dist; \
    for pkg in config contracts db domain validation; do \
      if [ -d "/runtime/node_modules/@xiaohai/$pkg" ]; then \
        mkdir -p "/runtime/node_modules/@xiaohai/$pkg/dist"; \
        cp -a "packages/$pkg/dist/." "/runtime/node_modules/@xiaohai/$pkg/dist/"; \
      fi; \
    done; \
    test -f "/runtime/dist/$([ "$SERVICE" = api ] && echo server || echo index).js"; \
    test -f /runtime/node_modules/@xiaohai/db/dist/src/index.js; \
    test -f /runtime/node_modules/@xiaohai/db/dist/migrations/meta/_journal.json

# Only the self-contained production deployment enters the final image.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG SERVICE=api
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
COPY --from=builder /runtime/ /app/apps/${SERVICE}/
CMD ["sh", "-c", "if [ \"$SERVICE_NAME\" = worker ]; then exec node apps/worker/dist/index.js; else exec node apps/api/dist/server.js; fi"]
