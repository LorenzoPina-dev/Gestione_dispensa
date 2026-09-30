FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-identity/package.json ./services/service-identity/package.json
COPY services/service-identity/tsconfig.json ./services/service-identity/tsconfig.json
COPY services/service-identity/src ./services/service-identity/src
COPY services/service-identity/migrations ./services/service-identity/migrations
WORKDIR /app/services/service-identity
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-identity/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-identity/dist ./dist
COPY --from=build /app/services/service-identity/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
