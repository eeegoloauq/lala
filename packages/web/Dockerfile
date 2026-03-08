# Build stage
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ARG VITE_LIVEKIT_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
RUN npm run build

# Production stage - Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
