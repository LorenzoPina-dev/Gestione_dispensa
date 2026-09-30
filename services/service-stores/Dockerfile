FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-stores/package.json ./services/service-stores/package.json
COPY services/service-stores/tsconfig.json ./services/service-stores/tsconfig.json
COPY services/service-stores/src ./services/service-stores/src
WORKDIR /app/services/service-stores
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-stores/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-stores/dist ./dist
CMD ["node","dist/server.js"]
