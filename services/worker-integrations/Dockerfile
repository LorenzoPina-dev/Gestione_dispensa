FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/worker-integrations/package.json services/worker-integrations/tsconfig.json ./services/worker-integrations/
RUN npm install
COPY services/worker-integrations/src ./services/worker-integrations/src
RUN npm --workspace @gestione-dispensa/worker-integrations run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/worker-integrations/package.json ./services/worker-integrations/
RUN npm install --workspace @gestione-dispensa/worker-integrations --omit=dev --ignore-scripts
COPY --from=build /app/services/worker-integrations/dist ./services/worker-integrations/dist
USER node
EXPOSE 3100
CMD ["node", "services/worker-integrations/dist/src/server.js"]
