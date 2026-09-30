FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-inventory/package.json ./services/service-inventory/package.json
COPY services/service-inventory/tsconfig.json ./services/service-inventory/tsconfig.json
COPY services/service-inventory/src ./services/service-inventory/src
COPY services/service-inventory/migrations ./services/service-inventory/migrations
WORKDIR /app/services/service-inventory
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/service-inventory/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-inventory/dist ./dist
COPY --from=build /app/services/service-inventory/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]