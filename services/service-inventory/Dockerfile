FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-inventory/package.json services/service-inventory/tsconfig.json ./services/service-inventory/
RUN npm install
COPY services/service-inventory/src ./services/service-inventory/src
RUN npm --workspace @gestione-dispensa/service-inventory run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-inventory/package.json ./services/service-inventory/
RUN npm install --workspace @gestione-dispensa/service-inventory --omit=dev --ignore-scripts
COPY --from=build /app/services/service-inventory/dist ./services/service-inventory/dist
USER node
EXPOSE 3312
CMD ["node", "services/service-inventory/dist/server.js"]
