FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-catalog/package.json services/service-catalog/tsconfig.json ./services/service-catalog/
RUN npm install
COPY services/service-catalog/src ./services/service-catalog/src
COPY services/service-catalog/migrations ./services/service-catalog/migrations
RUN npm --workspace @gestione-dispensa/service-catalog run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-catalog/package.json ./services/service-catalog/
RUN npm install --workspace @gestione-dispensa/service-catalog --omit=dev --ignore-scripts
COPY --from=build /app/services/service-catalog/dist ./services/service-catalog/dist
COPY --from=build /app/services/service-catalog/migrations ./services/service-catalog/migrations
USER node
EXPOSE 3314
CMD ["sh", "-c", "node services/service-catalog/dist/migrate.js && node services/service-catalog/dist/server.js"]
