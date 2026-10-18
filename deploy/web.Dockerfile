# Build stage — mirrors the repo layout because the frontend imports ../schema (Vite alias @schema) and bundles the
# help articles from ../docs/help (P2-24).
FROM node:22-alpine AS build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY schema/ /repo/schema/
COPY docs/help/ /repo/docs/help/
COPY frontend/ ./
RUN npm run build

# Serve stage
FROM nginx:1.30-alpine
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
