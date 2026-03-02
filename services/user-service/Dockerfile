
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --production

FROM node:20-alpine

RUN apk add --no-cache dumb-init


RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

COPY --chown=nodejs:nodejs . .

USER nodejs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3003/health || exit 1

CMD ["dumb-init", "node", "src/index.js"]
