FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/inventory/package.json ./services/inventory/package.json
COPY services/inventory/tsconfig.json ./services/inventory/tsconfig.json
COPY services/inventory/src ./services/inventory/src
WORKDIR /app/services/inventory
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/inventory/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/inventory/dist ./dist
CMD ["node","dist/server.js"]
