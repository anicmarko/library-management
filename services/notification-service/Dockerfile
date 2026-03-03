FROM node:20-alpine

RUN apk add --no-cache dumb-init

WORKDIR /workspace/service

# Create the data directory for SQLite
RUN mkdir -p /workspace/service/data

COPY services/shared/ /workspace/shared/
COPY services/notification-service/package*.json ./

RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force && \
    chmod -R a-w node_modules

COPY --chmod=555 services/notification-service/src ./src

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /workspace

USER nodejs

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3004/health || exit 1

CMD ["dumb-init", "node", "src/index.js"]
