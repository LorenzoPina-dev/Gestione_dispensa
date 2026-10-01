FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/gateway/package.json services/gateway/tsconfig.json ./services/gateway/
WORKDIR /app/services/gateway
RUN npm install
COPY services/gateway/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/gateway/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/gateway/dist ./dist
CMD ["node","dist/index.js"]
