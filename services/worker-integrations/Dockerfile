FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY services/worker-core/package.json services/worker-core/tsconfig.json ./services/worker-core/
COPY services/worker-core/src ./services/worker-core/src
COPY services/worker-integrations/package.json services/worker-integrations/tsconfig.json ./services/worker-integrations/
COPY services/worker-integrations/src ./services/worker-integrations/src
RUN npm install
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/worker-core run build
RUN npm --workspace @gestione-dispensa/worker-integrations run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/observability/package.json ./packages/observability/
COPY services/worker-core/package.json ./services/worker-core/
COPY services/worker-integrations/package.json ./services/worker-integrations/
RUN npm install --workspace @gestione-dispensa/worker-integrations --omit=dev --ignore-scripts
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/services/worker-core/dist ./services/worker-core/dist
COPY --from=build /app/services/worker-integrations/dist ./services/worker-integrations/dist
USER node
EXPOSE 3100
CMD ["node", "services/worker-integrations/dist/server.js"]
