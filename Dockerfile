# ---- Build stage: install deps with npm available ----
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

# ---- Runtime stage: minimal image, no build tools, no dev deps ----
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Pull in the latest Alpine security patches (e.g. openssl) on top of the base image,
# then drop npm/npx: the app only needs the node binary at runtime, and npm's bundled
# packages (tar, glob, ...) are a frequent source of scanner findings.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Run as a non-root user so a container escape doesn't hand out root.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json ./

USER appuser
EXPOSE 3000

# Used by orchestrators/Compose and polled by the DAST job to know the app is ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
