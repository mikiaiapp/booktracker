FROM nginx:1.27-alpine

ARG CACHE_BUST=v2.10.10

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
