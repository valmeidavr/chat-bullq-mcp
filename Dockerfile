FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
RUN ./node_modules/.bin/tsc

ENV NODE_ENV=production
ENV PORT=3110
EXPOSE 3110

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3110/health || exit 1

CMD ["node", "dist/index.js"]
