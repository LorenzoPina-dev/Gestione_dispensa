FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/gateway/package.json services/gateway/tsconfig.json ./services/gateway/
RUN npm install
COPY services/gateway/src ./services/gateway/src
RUN npm --workspace @gestione-dispensa/gateway run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/gateway/package.json ./services/gateway/
RUN npm install --workspace @gestione-dispensa/gateway --omit=dev --ignore-scripts
COPY --from=build /app/services/gateway/dist ./services/gateway/dist
USER node
EXPOSE 3300
CMD ["node", "services/gateway/dist/index.js"]
