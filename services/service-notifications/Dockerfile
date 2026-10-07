FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-notifications/package.json services/service-notifications/tsconfig.json ./services/service-notifications/
COPY services/service-notifications/src ./services/service-notifications/src
COPY services/service-notifications/migrations ./services/service-notifications/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-notifications run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-notifications/dist ./dist
COPY --from=build /app/services/service-notifications/migrations ./migrations
USER node
EXPOSE 3315
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
