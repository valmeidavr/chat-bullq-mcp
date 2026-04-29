FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

ENV PORT=3110
EXPOSE 3110

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3110/health || exit 1

CMD ["node", "dist/index.js"]
