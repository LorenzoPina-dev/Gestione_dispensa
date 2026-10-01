FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/service-ocr/package.json services/service-ocr/tsconfig.json ./services/service-ocr/
RUN npm install --ignore-scripts
COPY services/service-ocr/src ./services/service-ocr/src
RUN npm --workspace @gestione-dispensa/service-ocr run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/service-ocr/package.json ./services/service-ocr/
RUN npm install --workspace @gestione-dispensa/service-ocr --omit=dev --ignore-scripts
COPY --from=build /app/services/service-ocr/dist ./services/service-ocr/dist
USER node
EXPOSE 3405
CMD ["node", "services/service-ocr/dist/index.js"]
