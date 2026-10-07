FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-auth/package.json packages/runtime-auth/tsconfig.json ./packages/runtime-auth/
COPY packages/runtime-auth/src ./packages/runtime-auth/src
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-catalog/package.json services/service-catalog/tsconfig.json ./services/service-catalog/
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-auth run build
RUN npm --workspace @gestione-dispensa/runtime-db run build
COPY services/service-catalog/src ./services/service-catalog/src
COPY services/service-catalog/migrations ./services/service-catalog/migrations
RUN npm --workspace @gestione-dispensa/service-catalog run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/service-catalog/package.json ./package.json
COPY packages/runtime-auth/package.json ./node_modules/@gestione-dispensa/runtime-auth/package.json
COPY packages/runtime-db/package.json ./node_modules/@gestione-dispensa/runtime-db/package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/packages/runtime-auth/dist ./node_modules/@gestione-dispensa/runtime-auth/dist
COPY --from=build /app/packages/runtime-db/dist ./node_modules/@gestione-dispensa/runtime-db/dist
COPY --from=build /app/services/service-catalog/dist ./dist
COPY --from=build /app/services/service-catalog/migrations ./migrations
USER node
EXPOSE 3314
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
