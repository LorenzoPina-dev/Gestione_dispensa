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

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/observability/package.json ./packages/observability/
COPY packages/runtime-auth/package.json ./packages/runtime-auth/
COPY packages/runtime-db/package.json ./packages/runtime-db/
COPY services/worker-core/package.json ./services/worker-core/
COPY services/service-jobs/package.json ./services/service-jobs/
RUN npm install --workspace @gestione-dispensa/service-jobs --omit=dev --ignore-scripts
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/packages/runtime-auth/dist ./packages/runtime-auth/dist
COPY --from=build /app/packages/runtime-db/dist ./packages/runtime-db/dist
COPY --from=build /app/services/worker-core/dist ./services/worker-core/dist
COPY --from=build /app/services/service-jobs/dist ./services/service-jobs/dist
COPY --from=build /app/services/service-jobs/migrations ./services/service-jobs/migrations
USER node
WORKDIR /app/services/service-jobs
EXPOSE 3317
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
