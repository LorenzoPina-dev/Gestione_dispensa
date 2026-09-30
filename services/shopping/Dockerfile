FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/shopping/package.json ./services/shopping/package.json
COPY services/shopping/tsconfig.json ./services/shopping/tsconfig.json
COPY services/shopping/src ./services/shopping/src
WORKDIR /app/services/shopping
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/shopping/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/shopping/dist ./dist
CMD ["node","dist/server.js"]
