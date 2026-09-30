FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/vision/package.json ./services/vision/package.json
COPY services/vision/tsconfig.json ./services/vision/tsconfig.json
COPY services/vision/src ./services/vision/src
WORKDIR /app/services/vision
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/vision/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/vision/dist ./dist
CMD ["node","dist/server.js"]
