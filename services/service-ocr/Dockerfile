FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/runtime-db/package.json packages/runtime-db/tsconfig.json ./packages/runtime-db/
COPY packages/runtime-db/src ./packages/runtime-db/src
COPY services/service-ocr/package.json services/service-ocr/tsconfig.json ./services/service-ocr/
COPY services/service-ocr/src ./services/service-ocr/src
COPY services/service-ocr/migrations ./services/service-ocr/migrations
RUN npm install
RUN npm --workspace @gestione-dispensa/runtime-db run build
RUN npm --workspace @gestione-dispensa/service-ocr run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/service-ocr/dist ./dist
COPY --from=build /app/services/service-ocr/migrations ./migrations
USER node
EXPOSE 3405
CMD ["sh","-c","node dist/migrate.js && node dist/index.js"]
