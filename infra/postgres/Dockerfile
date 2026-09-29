FROM node:22-alpine

RUN apk add --no-cache postgresql16-client

WORKDIR /app

COPY package.json package-lock.json ./
COPY infra/postgres/scripts/migrate.mjs ./infra/postgres/scripts/migrate.mjs
COPY infra/postgres/migrations ./infra/postgres/migrations

ENV NODE_ENV=production

CMD ["node", "infra/postgres/scripts/migrate.mjs", "migrate"]
