# calvin's production image (ADR 0006). Node 26 runs the .ts sources directly, so there's no build step.
# Debian slim, not Alpine: the Temporal worker's native core needs glibc.
FROM node:26-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY drizzle ./drizzle
COPY public ./public
COPY src ./src

USER node
CMD ["node","src/main.ts"]
