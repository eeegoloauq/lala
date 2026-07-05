# Build context is the REPO ROOT (CI runs: docker build -f packages/web/Dockerfile .)
# so the types-only @lala/shared file: dependency resolves at ../shared.

# Build stage
FROM node:20-alpine AS build
WORKDIR /app/packages/web

COPY packages/shared /app/packages/shared
COPY packages/web/package.json packages/web/package-lock.json packages/web/.npmrc ./
RUN npm ci

COPY packages/web/ ./
ARG VITE_LIVEKIT_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
RUN npm run build

# Production stage - Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
