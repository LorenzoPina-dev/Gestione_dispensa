FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-jobs/package.json services/service-jobs/tsconfig.json ./services/service-jobs/
RUN npm install --ignore-scripts
COPY services/service-jobs/src ./services/service-jobs/src
RUN npm --workspace @gestione-dispensa/service-jobs run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-jobs/package.json ./services/service-jobs/
RUN npm install --workspace @gestione-dispensa/service-jobs --omit=dev --ignore-scripts
COPY --from=build /app/services/service-jobs/dist ./services/service-jobs/dist
USER node
EXPOSE 3317
CMD ["node", "services/service-jobs/dist/server.js"]
