FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-food-semantics/package.json services/service-food-semantics/tsconfig.json ./services/service-food-semantics/
COPY services/service-food-semantics/src ./services/service-food-semantics/src
COPY services/service-food-semantics/migrations ./services/service-food-semantics/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-food-semantics run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-food-semantics/dist ./dist
COPY --from=build /app/services/service-food-semantics/migrations ./migrations
USER node
EXPOSE 3410
CMD ["node","dist/server.js"]
