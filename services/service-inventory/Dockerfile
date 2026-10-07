FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-inventory/package.json services/service-inventory/tsconfig.json ./services/service-inventory/
COPY services/service-inventory/src ./services/service-inventory/src
COPY services/service-inventory/migrations ./services/service-inventory/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-inventory run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-inventory/dist ./dist
COPY --from=build /app/services/service-inventory/migrations ./migrations
COPY services/service-inventory/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3312
CMD ["./docker-entrypoint.sh"]
