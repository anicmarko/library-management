FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /workspace/service

COPY --chmod=755 services/shared/ /workspace/shared/
COPY --chmod=755 services/notification-service/package*.json ./

RUN cd /workspace/shared && npm install --omit=dev && \
    cd /workspace/service && npm install --omit=dev && \
    npm cache clean --force

FROM node:20-alpine

ENV NODE_ENV=production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /workspace/service

RUN mkdir -p /workspace/service/data && \
    chown nodejs:nodejs /workspace/service/data

COPY --chmod=755 --chown=nodejs:nodejs services/shared/ /workspace/shared/
COPY --from=builder --chmod=755 --chown=nodejs:nodejs /workspace/shared/node_modules /workspace/shared/node_modules

COPY --chmod=755 --chown=nodejs:nodejs services/notification-service/package*.json ./
COPY --from=builder --chmod=755 --chown=nodejs:nodejs /workspace/service/node_modules ./node_modules

COPY --chmod=755 --chown=nodejs:nodejs services/notification-service/src ./src

USER nodejs

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3004/health || exit 1

CMD ["dumb-init", "node", "src/index.js"]
