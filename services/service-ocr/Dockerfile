FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY services/service-ocr/package.json services/service-ocr/tsconfig.json ./services/service-ocr/
COPY services/service-ocr/src ./services/service-ocr/src
COPY services/service-ocr/migrations ./services/service-ocr/migrations
RUN npm install --ignore-scripts
RUN npm --workspace @gestione-dispensa/observability run build
RUN npm --workspace @gestione-dispensa/service-ocr run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/observability/package.json ./packages/observability/
COPY services/service-ocr/package.json ./services/service-ocr/
RUN npm install --workspace @gestione-dispensa/service-ocr --omit=dev --ignore-scripts
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/services/service-ocr/dist ./services/service-ocr/dist
COPY --from=build /app/services/service-ocr/migrations ./migrations
USER node
EXPOSE 3405
CMD ["sh","-c","node services/service-ocr/dist/migrate.js && node services/service-ocr/dist/index.js"]
