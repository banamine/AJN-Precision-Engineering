# AJN Cloud Run runtime
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts skips Puppeteer's Chrome download; the runtime never launches a browser.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 8080
CMD ["node", "dist/server.cjs"]
