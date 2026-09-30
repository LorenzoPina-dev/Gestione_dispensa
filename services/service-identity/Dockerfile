FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-identity/package.json ./services/service-identity/package.json
COPY services/service-identity/tsconfig.json ./services/service-identity/tsconfig.json
COPY services/service-identity/src ./services/service-identity/src
WORKDIR /app/services/service-identity
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-identity/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-identity/dist ./dist
CMD ["node","dist/server.js"]
