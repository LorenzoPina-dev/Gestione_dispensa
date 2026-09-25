FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
# The api imports the TS-only workspace package @gestione-dispensa/observability (its
# package.json "exports" points at ./src/index.ts). It must be present before `npm install`
# so the workspace symlink is created, otherwise `tsc` fails with TS2307 "Cannot find module".
COPY packages/observability/package.json ./packages/observability/
RUN npm install
COPY apps/api/src ./apps/api/src
COPY packages/observability/src ./packages/observability/src
RUN npm --workspace @gestione-dispensa/api run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Frontend files are not needed at runtime, but the workspace manifests are: they describe the
# api's production dependencies (express/pg/jose) and the local observability workspace link.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/observability/package.json ./packages/observability/
RUN npm install --workspace @gestione-dispensa/api --omit=dev --ignore-scripts
COPY --from=build /app/apps/api/dist ./apps/api/dist
# observability ships as TypeScript source, so it travels with the image and is loaded with
# Node's native type stripping (--experimental-strip-types in CMD) instead of a build step.
COPY --from=build /app/packages/observability/src ./packages/observability/src
USER node
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "apps/api/dist/server.js"]
