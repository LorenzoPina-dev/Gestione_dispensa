FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-nutrition/package.json services/service-nutrition/tsconfig.json ./services/service-nutrition/
COPY services/service-nutrition/src ./services/service-nutrition/src
COPY services/service-nutrition/migrations ./services/service-nutrition/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-nutrition run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-nutrition/dist ./dist
COPY --from=build /app/services/service-nutrition/migrations ./migrations
USER node
EXPOSE 3402
CMD ["sh","-c","DATABASE_URL=\"${MIGRATION_DATABASE_URL:-${DATABASE_URL}}\" node dist/migrate.js && node dist/server.js"]
