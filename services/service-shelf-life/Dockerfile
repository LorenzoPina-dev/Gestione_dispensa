FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-shelf-life/package.json ./services/service-shelf-life/package.json
COPY services/service-shelf-life/tsconfig.json ./services/service-shelf-life/tsconfig.json
COPY services/service-shelf-life/src ./services/service-shelf-life/src
COPY services/service-shelf-life/migrations ./services/service-shelf-life/migrations
WORKDIR /app/services/service-shelf-life
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY services/service-shelf-life/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-shelf-life/dist ./dist
COPY --from=build /app/services/service-shelf-life/migrations ./migrations
CMD ["sh","-c","node dist/migrate.js && node dist/index.js"]
