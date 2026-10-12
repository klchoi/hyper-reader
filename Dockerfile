# For working on the app (see compose.yaml): Node, and the dependencies of the lock file, built
# for Linux (the ones on this machine are built for it, and stay out of the container). The
# source is not in the image: compose.yaml mounts the working copy over /app.
FROM node:24.12.0-bookworm-slim AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
