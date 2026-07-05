# Build context is the REPO ROOT (CI runs: docker build -f packages/api/Dockerfile .)
# so the types-only @lala/shared file: dependency resolves at ../shared.

# Build stage
FROM node:20-alpine AS build
WORKDIR /app/packages/api

COPY packages/shared /app/packages/shared
COPY packages/api/package.json packages/api/package-lock.json packages/api/.npmrc ./
RUN npm ci

COPY packages/api/tsconfig.json ./
COPY packages/api/src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app/packages/api

COPY packages/shared /app/packages/shared
COPY packages/api/package.json packages/api/package-lock.json packages/api/.npmrc ./
RUN npm ci --omit=dev

COPY --from=build /app/packages/api/dist ./dist

EXPOSE 3001

USER node
CMD ["node", "dist/index.js"]
