FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-family/package.json services/service-family/tsconfig.json ./services/service-family/
RUN npm install
COPY services/service-family/src ./services/service-family/src
RUN npm --workspace @gestione-dispensa/service-family run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-family/package.json ./services/service-family/
RUN npm install --workspace @gestione-dispensa/service-family --omit=dev --ignore-scripts
COPY --from=build /app/services/service-family/dist ./services/service-family/dist
USER node
EXPOSE 3311
CMD ["node", "services/service-family/dist/server.js"]
