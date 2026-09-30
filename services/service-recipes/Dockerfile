FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/service-recipes/package.json ./services/service-recipes/package.json
COPY services/service-recipes/tsconfig.json ./services/service-recipes/tsconfig.json
COPY services/service-recipes/src ./services/service-recipes/src
WORKDIR /app/services/service-recipes
RUN npm install && npm run build
FROM node:22-alpine
WORKDIR /app
COPY services/service-recipes/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/service-recipes/dist ./dist
CMD ["node","dist/server.js"]
