FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-family/package.json services/service-family/tsconfig.json ./services/service-family/
COPY services/service-family/src ./services/service-family/src
COPY services/service-family/migrations ./services/service-family/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-family run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-family/dist ./dist
COPY --from=build /app/services/service-family/migrations ./migrations
USER node
EXPOSE 3311
CMD ["sh","-c","DATABASE_URL=\"${MIGRATION_DATABASE_URL:-${DATABASE_URL}}\" node dist/migrate.js && node dist/server.js"]
