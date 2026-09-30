FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-nutrition/package.json ./services/service-nutrition/package.json
COPY services/service-nutrition/tsconfig.json ./services/service-nutrition/tsconfig.json
COPY services/service-nutrition/src ./services/service-nutrition/src
WORKDIR /app/services/service-nutrition
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-nutrition/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-nutrition/dist ./dist
CMD ["node","dist/server.js"]
