FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_ITM_API_URL=https://itm.hamradio.my
ARG VITE_OPEN_ELEVATION_API_URL=https://elevation.hamradio.my/api/v1/lookup
ENV VITE_ITM_API_URL=$VITE_ITM_API_URL
ENV VITE_OPEN_ELEVATION_API_URL=$VITE_OPEN_ELEVATION_API_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/docs /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
