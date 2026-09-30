FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/identity/package.json ./services/identity/package.json
COPY services/identity/tsconfig.json ./services/identity/tsconfig.json
COPY services/identity/src ./services/identity/src
WORKDIR /app/services/identity
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/identity/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/identity/dist ./dist
CMD ["node","dist/server.js"]
