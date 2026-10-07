FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY services/gateway/package.json services/gateway/tsconfig.json ./services/gateway/
COPY services/gateway/src ./services/gateway/src
RUN npm install
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/gateway run build
RUN npm prune --omit=dev
# jose@5 (gateway) può restare annidato in services/gateway/node_modules perché la root hoista jose@6 (runtime-auth)
RUN mkdir -p /app/services/gateway/node_modules

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/observability ./packages/observability
COPY --from=build /app/services/gateway/dist ./dist
COPY --from=build /app/services/gateway/node_modules ./dist/node_modules
CMD ["node","dist/index.js"]
