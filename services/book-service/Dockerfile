FROM node:20-alpine AS builder

WORKDIR /workspace/service

COPY services/shared/ /workspace/shared/
COPY services/book-service/package*.json ./

RUN npm install

COPY services/book-service/src ./src

FROM node:20-alpine AS production

WORKDIR /workspace/service

RUN apk add --no-cache dumb-init

COPY services/shared/ /workspace/shared/
COPY services/book-service/package*.json ./

RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force && \
    chmod -R a-w node_modules

COPY --from=builder --chmod=555 /workspace/service/src ./src

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /workspace

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "src/index.js"]
