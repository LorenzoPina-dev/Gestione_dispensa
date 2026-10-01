FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-notifications/package.json ./services/service-notifications/package.json
COPY services/service-notifications/tsconfig.json ./services/service-notifications/tsconfig.json
COPY services/service-notifications/src ./services/service-notifications/src
COPY services/service-notifications/migrations ./services/service-notifications/migrations
WORKDIR /app/services/service-notifications
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY services/service-notifications/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-notifications/dist ./dist
COPY --from=build /app/services/service-notifications/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
