FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-shelf-life/package.json services/service-shelf-life/tsconfig.json ./services/service-shelf-life/
RUN npm install --ignore-scripts
COPY services/service-shelf-life/src ./services/service-shelf-life/src
RUN npm --workspace @gestione-dispensa/service-shelf-life run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-shelf-life/package.json ./services/service-shelf-life/
RUN npm install --workspace @gestione-dispensa/service-shelf-life --omit=dev --ignore-scripts
COPY --from=build /app/services/service-shelf-life/dist ./services/service-shelf-life/dist
USER node
EXPOSE 3404
CMD ["node", "services/service-shelf-life/dist/index.js"]
