FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY services/web/package.json services/web/tsconfig.json services/web/tsconfig.app.json ./services/web/

RUN npm install

COPY services/web/src ./services/web/src
COPY services/web/index.html services/web/vite.config.ts ./services/web/

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_OIDC_ISSUER=/realms/dispensa
ARG VITE_OIDC_CLIENT_ID=dispensa-app

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID

RUN npm --workspace @gestione-dispensa/web run build

FROM nginx:1.27-alpine
COPY services/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/services/web/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --spider --quiet http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
