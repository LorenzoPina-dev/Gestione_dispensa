FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY services ./services
COPY packages ./packages
RUN npm ci --ignore-scripts
RUN npm --workspace @gestione-dispensa/service-shelf-life run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/service-shelf-life/dist ./dist
CMD ["node", "dist/index.js"]
