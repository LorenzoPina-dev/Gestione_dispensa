FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/worker-shopping/package.json ./services/worker-shopping/package.json
COPY services/worker-shopping/tsconfig.json ./services/worker-shopping/tsconfig.json
COPY services/worker-shopping/src ./services/worker-shopping/src
WORKDIR /app/services/worker-shopping
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/worker-shopping/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/worker-shopping/dist ./dist
CMD ["node","dist/run.js"]
