FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-shelf-life/package.json services/service-shelf-life/tsconfig.json ./services/service-shelf-life/
COPY services/service-shelf-life/src ./services/service-shelf-life/src
COPY services/service-shelf-life/migrations ./services/service-shelf-life/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-shelf-life run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-shelf-life/dist ./dist
COPY --from=build /app/services/service-shelf-life/migrations ./migrations
USER node
EXPOSE 3404
CMD ["sh","-c","node dist/migrate.js && node dist/index.js"]
