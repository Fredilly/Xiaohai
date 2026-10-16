FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @xiaohai/api... build && pnpm --filter @xiaohai/worker... build
ARG SERVICE=api
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
CMD ["sh","-c","if [ \"$SERVICE_NAME\" = worker ]; then exec pnpm --filter @xiaohai/worker start; else exec pnpm --filter @xiaohai/api start; fi"]
