FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_URL
ARG VITE_APP_PASSWORD
ARG VITE_ENABLE_NLP=false
ARG VITE_MAPS_PROVIDER=osm
ARG VITE_GMAPS_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_PASSWORD=$VITE_APP_PASSWORD
ENV VITE_ENABLE_NLP=$VITE_ENABLE_NLP
ENV VITE_MAPS_PROVIDER=$VITE_MAPS_PROVIDER
ENV VITE_GMAPS_API_KEY=$VITE_GMAPS_API_KEY
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: route all 404s back to index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
