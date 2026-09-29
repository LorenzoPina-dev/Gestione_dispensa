FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-notifications/package.json services/service-notifications/tsconfig.json ./services/service-notifications/
RUN npm install
COPY services/service-notifications/src ./services/service-notifications/src
RUN npm --workspace @gestione-dispensa/service-notifications run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-notifications/package.json ./services/service-notifications/
RUN npm install --workspace @gestione-dispensa/service-notifications --omit=dev --ignore-scripts
COPY --from=build /app/services/service-notifications/dist ./services/service-notifications/dist
USER node
EXPOSE 3315
CMD ["node", "services/service-notifications/dist/server.js"]
