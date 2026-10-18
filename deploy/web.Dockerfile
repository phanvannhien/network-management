# Build stage — mirrors the repo layout because the frontend imports ../schema (Vite alias @schema).
FROM node:22-alpine AS build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY schema/ /repo/schema/
COPY frontend/ ./
RUN npm run build

# Serve stage
FROM nginx:1.30-alpine
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
