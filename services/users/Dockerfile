FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/users/package.json ./services/users/package.json
COPY services/users/tsconfig.json ./services/users/tsconfig.json
COPY services/users/src ./services/users/src
WORKDIR /app/services/users
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY services/users/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/services/users/dist ./dist
CMD ["node","dist/server.js"]
