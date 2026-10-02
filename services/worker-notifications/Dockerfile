FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/worker-notifications/package.json ./services/worker-notifications/package.json
COPY services/worker-notifications/tsconfig.json ./services/worker-notifications/tsconfig.json
COPY services/worker-notifications/src ./services/worker-notifications/src
WORKDIR /app/services/worker-notifications
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/worker-notifications/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/worker-notifications/dist ./dist
CMD ["node","dist/run.js"]
