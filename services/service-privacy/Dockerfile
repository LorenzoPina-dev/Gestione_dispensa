FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-auth/package.json packages/runtime-auth/tsconfig.json ./packages/runtime-auth/
COPY packages/runtime-auth/src ./packages/runtime-auth/src
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-privacy/package.json services/service-privacy/tsconfig.json ./services/service-privacy/
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-auth run build
RUN npm --workspace @gestione-dispensa/runtime-db run build
COPY services/service-privacy/src ./services/service-privacy/src
COPY services/service-privacy/migrations ./services/service-privacy/migrations
RUN npm --workspace @gestione-dispensa/service-privacy run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-privacy/package.json ./services/service-privacy/
COPY packages/runtime-auth/package.json ./packages/runtime-auth/
COPY packages/runtime-db/package.json ./packages/runtime-db/
RUN npm install --workspace @gestione-dispensa/service-privacy --omit=dev --ignore-scripts
COPY --from=build /app/packages/runtime-auth/dist ./packages/runtime-auth/dist
COPY --from=build /app/packages/runtime-db/dist ./packages/runtime-db/dist
COPY --from=build /app/services/service-privacy/dist ./services/service-privacy/dist
COPY --from=build /app/services/service-privacy/migrations ./migrations
COPY services/service-privacy/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3316
CMD ["./docker-entrypoint.sh"]
