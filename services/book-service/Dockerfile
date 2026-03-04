FROM node:20-alpine AS builder

WORKDIR /workspace/service

COPY --chmod=755 services/shared/ /workspace/shared/
COPY --chmod=755 services/book-service/package*.json ./

RUN npm install

COPY --chmod=755 services/book-service/src ./src

FROM node:20-alpine AS production

ENV NODE_ENV=production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /workspace/service

COPY --chmod=755 --chown=nodejs:nodejs services/shared/ /workspace/shared/
COPY --chmod=755 --chown=nodejs:nodejs services/book-service/package*.json ./

RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY --from=builder --chmod=755 --chown=nodejs:nodejs /workspace/service/src ./src

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "src/index.js"]
