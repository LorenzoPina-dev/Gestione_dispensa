FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/stores/package.json ./services/stores/package.json
COPY services/stores/tsconfig.json ./services/stores/tsconfig.json
COPY services/stores/src ./services/stores/src
WORKDIR /app/services/stores
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/stores/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/stores/dist ./dist
CMD ["node","dist/server.js"]
