FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-identity/package.json services/service-identity/tsconfig.json ./services/service-identity/
COPY services/service-identity/src ./services/service-identity/src
COPY services/service-identity/migrations ./services/service-identity/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-identity run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-identity/dist ./dist
COPY --from=build /app/services/service-identity/migrations ./migrations
USER node
EXPOSE 3310
CMD ["sh","-c","DATABASE_URL=\"\${MIGRATION_DATABASE_URL:-\${DATABASE_URL}}\" node dist/migrate.js && node dist/server.js"]
