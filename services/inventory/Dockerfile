FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/inventory/package.json ./services/inventory/package.json
COPY services/inventory/tsconfig.json ./services/inventory/tsconfig.json
COPY services/inventory/src ./services/inventory/src
COPY services/inventory/migrations ./services/inventory/migrations
WORKDIR /app/services/inventory
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/inventory/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/inventory/dist ./dist
COPY --from=build /app/services/inventory/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/server.js"]