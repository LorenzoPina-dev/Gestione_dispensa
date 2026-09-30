FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY services/worker-core/package.json services/worker-core/tsconfig.json ./services/worker-core/
COPY services/worker-core/src ./services/worker-core/src

RUN npm install
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/worker-core run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/observability/package.json ./packages/observability/
COPY services/worker-core/package.json ./services/worker-core/
RUN npm install --workspace @gestione-dispensa/worker-core --omit=dev --ignore-scripts

COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/services/worker-core/dist ./services/worker-core/dist

USER node

CMD ["node", "services/worker-core/dist/run.js"]
