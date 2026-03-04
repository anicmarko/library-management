FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY src ./src

FROM node:20-alpine AS production

ENV NODE_ENV=production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY --chown=nodejs:nodejs package*.json ./

RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY --from=builder --chmod=755 --chown=nodejs:nodejs /app/src ./src

USER nodejs

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "src/index.js"]
