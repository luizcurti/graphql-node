FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# dotenv prints a random promotional "tip" line to stdout on every load
# otherwise (see node_modules/dotenv/lib/main.js) — pure log noise here,
# since config actually comes from the container's real env vars, not a
# .env file.
ENV DOTENV_CONFIG_QUIET=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 4003
CMD ["node", "-r", "dotenv/config", "-r", "./dist/observability/tracing.js", "dist/index.js"]
