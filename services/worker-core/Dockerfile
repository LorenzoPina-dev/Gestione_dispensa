FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/worker-core/package.json services/worker-core/tsconfig.json ./services/worker-core/
COPY packages/observability/package.json ./packages/observability/

RUN npm install

COPY services/worker-core/src ./services/worker-core/src
COPY packages/observability/src ./packages/observability/src

RUN npm --workspace @gestione-dispensa/worker-core run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY services/worker-core/package.json ./services/worker-core/
COPY packages/observability/package.json ./packages/observability/

RUN npm install --workspace @gestione-dispensa/worker-core --omit=dev --ignore-scripts

COPY --from=build /app/services/worker-core/dist ./services/worker-core/dist
COPY --from=build /app/packages/observability/src ./packages/observability/src

USER node

CMD ["node", "--experimental-strip-types", "services/worker-core/dist/run.js"]
