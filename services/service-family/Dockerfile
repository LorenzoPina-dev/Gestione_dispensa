FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-family/package.json ./services/service-family/package.json
COPY services/service-family/tsconfig.json ./services/service-family/tsconfig.json
COPY services/service-family/src ./services/service-family/src
COPY services/service-family/migrations ./services/service-family/migrations
WORKDIR /app/services/service-family
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-family/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-family/dist ./dist
COPY --from=build /app/services/service-family/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
