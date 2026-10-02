FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/worker-outbox/package.json ./services/worker-outbox/package.json
COPY services/worker-outbox/tsconfig.json ./services/worker-outbox/tsconfig.json
COPY services/worker-outbox/src ./services/worker-outbox/src
WORKDIR /app/services/worker-outbox
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/worker-outbox/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/worker-outbox/dist ./dist
CMD ["node","dist/run.js"]
