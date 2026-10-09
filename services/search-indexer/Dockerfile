FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/search-indexer/package.json services/search-indexer/tsconfig.json ./services/search-indexer/
RUN npm install --workspace @gestione-dispensa/search-indexer
COPY services/search-indexer/src ./services/search-indexer/src
RUN npm run build --workspace @gestione-dispensa/search-indexer

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/search-indexer/package.json ./services/search-indexer/
RUN npm install --workspace @gestione-dispensa/search-indexer --omit=dev --ignore-scripts
COPY --from=build /app/services/search-indexer/dist ./services/search-indexer/dist
USER node
EXPOSE 3210
CMD ["node", "services/search-indexer/dist/server.js"]
