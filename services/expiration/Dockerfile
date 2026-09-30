FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/expiration/package.json ./services/expiration/package.json
COPY services/expiration/tsconfig.json ./services/expiration/tsconfig.json
COPY services/expiration/src ./services/expiration/src
WORKDIR /app/services/expiration
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/expiration/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/expiration/dist ./dist
CMD ["node","dist/server.js"]
