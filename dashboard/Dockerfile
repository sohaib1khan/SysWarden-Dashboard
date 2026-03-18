# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile
COPY . .
RUN npm run build

# Runtime stage — serve compiled assets with nginx
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA routing: all paths fall back to index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
