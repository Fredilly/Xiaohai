# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @xiaohai/validation build \
 && pnpm --filter @xiaohai/config build \
 && pnpm --filter @xiaohai/db build \
 && pnpm --filter @xiaohai/contracts build \
 && pnpm --filter @xiaohai/worker build

FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/config/package.json ./packages/config/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/validation/dist ./packages/validation/dist
COPY --from=build /app/packages/validation/package.json ./packages/validation/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY apps/api/scripts/entrypoint.sh ./apps/api/scripts/entrypoint.sh
RUN chmod +x ./apps/api/scripts/entrypoint.sh
ENTRYPOINT ["./apps/api/scripts/entrypoint.sh"]
CMD ["node", "apps/worker/dist/index.js"]
