FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-privacy/package.json services/service-privacy/tsconfig.json ./services/service-privacy/
RUN npm install
COPY services/service-privacy/src ./services/service-privacy/src
RUN npm --workspace @gestione-dispensa/service-privacy run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-privacy/package.json ./services/service-privacy/
RUN npm install --workspace @gestione-dispensa/service-privacy --omit=dev --ignore-scripts
COPY --from=build /app/services/service-privacy/dist ./services/service-privacy/dist
USER node
EXPOSE 3316
CMD ["node", "services/service-privacy/dist/server.js"]
