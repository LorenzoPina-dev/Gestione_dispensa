FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/barcode/package.json ./services/barcode/package.json
COPY services/barcode/tsconfig.json ./services/barcode/tsconfig.json
COPY services/barcode/src ./services/barcode/src
WORKDIR /app/services/barcode
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/barcode/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/barcode/dist ./dist
CMD ["node","dist/server.js"]
