FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY packages/food-rules/package.json packages/food-rules/tsconfig.json ./packages/food-rules/
COPY packages/food-rules/src ./packages/food-rules/src
COPY services/service-recipes/package.json services/service-recipes/tsconfig.json ./services/service-recipes/
COPY services/service-recipes/src ./services/service-recipes/src
COPY services/service-recipes/migrations ./services/service-recipes/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/food-rules run build
RUN npm --workspace @gestione-dispensa/service-recipes run build
RUN npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache unzip
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-recipes/dist ./dist
COPY --from=build /app/services/service-recipes/migrations ./migrations
USER node
EXPOSE 3401
CMD ["node","dist/server.js"]
