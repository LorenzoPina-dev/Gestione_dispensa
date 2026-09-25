FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/off-lookup/package.json services/off-lookup/tsconfig.json ./services/off-lookup/
RUN npm install
COPY services/off-lookup/src ./services/off-lookup/src
RUN npm --workspace @gestione-dispensa/off-lookup run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/off-lookup/package.json ./services/off-lookup/
RUN npm install --workspace @gestione-dispensa/off-lookup --omit=dev --ignore-scripts
COPY --from=build /app/services/off-lookup/dist ./services/off-lookup/dist
USER node
EXPOSE 3200
CMD ["node", "services/off-lookup/dist/server.js"]
