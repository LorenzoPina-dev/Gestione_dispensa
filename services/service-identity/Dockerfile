FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-identity/package.json services/service-identity/tsconfig.json ./services/service-identity/
RUN npm install
COPY services/service-identity/src ./services/service-identity/src
RUN npm --workspace @gestione-dispensa/service-identity run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-identity/package.json ./services/service-identity/
RUN npm install --workspace @gestione-dispensa/service-identity --omit=dev --ignore-scripts
COPY --from=build /app/services/service-identity/dist ./services/service-identity/dist
USER node
EXPOSE 3310
CMD ["node", "services/service-identity/dist/server.js"]
