FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-shopping/package.json services/service-shopping/tsconfig.json ./services/service-shopping/
RUN npm install
COPY services/service-shopping/src ./services/service-shopping/src
RUN npm --workspace @gestione-dispensa/service-shopping run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-shopping/package.json ./services/service-shopping/
RUN npm install --workspace @gestione-dispensa/service-shopping --omit=dev --ignore-scripts
COPY --from=build /app/services/service-shopping/dist ./services/service-shopping/dist
USER node
EXPOSE 3313
CMD ["node", "services/service-shopping/dist/server.js"]
