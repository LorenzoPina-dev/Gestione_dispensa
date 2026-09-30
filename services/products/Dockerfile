FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/products/package.json ./services/products/package.json
COPY services/products/tsconfig.json ./services/products/tsconfig.json
COPY services/products/src ./services/products/src
WORKDIR /app/services/products
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/products/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/products/dist ./dist
CMD ["node","dist/server.js"]
