FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY services/worker-core/package.json services/worker-core/tsconfig.json ./services/worker-core/
COPY services/worker-core/src ./services/worker-core/src
COPY services/service-jobs/package.json services/service-jobs/tsconfig.json ./services/service-jobs/
COPY services/service-jobs/src ./services/service-jobs/src
COPY services/service-jobs/migrations ./services/service-jobs/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/worker-core run build
RUN npm --workspace @gestione-dispensa/service-jobs run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/observability/package.json ./packages/observability/
COPY services/worker-core/package.json ./services/worker-core/
COPY services/service-jobs/package.json ./services/service-jobs/
RUN npm install --workspace @gestione-dispensa/service-jobs --omit=dev --ignore-scripts
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/services/worker-core/dist ./services/worker-core/dist
COPY --from=build /app/services/service-jobs/dist ./services/service-jobs/dist
COPY --from=build /app/services/service-jobs/migrations ./services/service-jobs/migrations
USER node
EXPOSE 3317
CMD ["sh","-c","node services/service-jobs/dist/migrate.js && node services/service-jobs/dist/server.js"]
