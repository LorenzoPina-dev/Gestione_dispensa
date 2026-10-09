FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /usr/local/bin/dispensa-nginx-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/dispensa-nginx-entrypoint && chmod +x /usr/local/bin/dispensa-nginx-entrypoint

EXPOSE 8443

ENTRYPOINT ["/usr/local/bin/dispensa-nginx-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
