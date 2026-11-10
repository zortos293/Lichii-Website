FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=cloudflare/cloudflared:2026.10.7 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=cloudflare/cloudflared:2026.10.7 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/docs ./docs
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "server/entrypoint.sh"]
CMD ["node", "--import", "tsx", "server/index.ts"]
