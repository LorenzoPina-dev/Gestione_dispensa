FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/runtime-auth/package.json packages/runtime-auth/tsconfig.json ./packages/runtime-auth/
COPY packages/runtime-auth/src ./packages/runtime-auth/src
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY packages/observability/src ./packages/observability/src
COPY services/worker-core/package.json services/worker-core/tsconfig.json ./services/worker-core/
COPY services/worker-core/src ./services/worker-core/src
COPY services/service-jobs/package.json services/service-jobs/tsconfig.json ./services/service-jobs/
COPY services/service-jobs/src ./services/service-jobs/src
COPY services/service-jobs/migrations ./services/service-jobs/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-auth run build
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/worker-core run build
RUN npm --workspace @gestione-dispensa/service-jobs run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-jobs/dist ./dist
COPY --from=build /app/services/service-jobs/migrations ./migrations
USER node
EXPOSE 3317
CMD ["sh","-c","DATABASE_URL=\"\${MIGRATION_DATABASE_URL:-\${DATABASE_URL}}\" node dist/migrate.js && node dist/server.js"]
