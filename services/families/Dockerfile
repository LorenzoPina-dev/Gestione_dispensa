FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/families/package.json ./services/families/package.json
COPY services/families/tsconfig.json ./services/families/tsconfig.json
COPY services/families/src ./services/families/src
WORKDIR /app/services/families
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/families/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/families/dist ./dist
CMD ["node","dist/server.js"]
