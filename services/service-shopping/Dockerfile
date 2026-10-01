FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-shopping/package.json ./services/service-shopping/package.json
COPY services/service-shopping/tsconfig.json ./services/service-shopping/tsconfig.json
COPY services/service-shopping/src ./services/service-shopping/src
COPY services/service-shopping/migrations ./services/service-shopping/migrations
WORKDIR /app/services/service-shopping
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY services/service-shopping/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-shopping/dist ./dist
COPY --from=build /app/services/service-shopping/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]
