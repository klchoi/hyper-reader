# Two images:
#   dev  for working on the app (see compose.yaml): Node, and the dependencies of the lock file,
#        built for Linux (the ones on this machine are built for it, and stay out of the
#        container). The source is not in the image: compose.yaml mounts the working copy over /app.
#   app  the app to run (the default): the page built from src/, and the server, which needs
#        nothing but Node and the parser. Its books are mounted at /books, read-only, and what it
#        keeps (the database, the books dropped on the page) at /data:
#
#          docker run -v /path/to/books:/books:ro -v /path/to/data:/data -p 127.0.0.1:8080:8080 <image>
#
#        The arguments are the server's (see server/server.ts), after `--host=0.0.0.0 --data=/data`;
#        given none, it reads the books in /books as the library `books`.
FROM node:24.12.0-bookworm-slim AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# the page, built once wherever the image is built: it is the same page on every platform
FROM --platform=$BUILDPLATFORM node:24.12.0-bookworm-slim AS page
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24.12.0-bookworm-slim AS app
LABEL org.opencontainers.image.source=https://github.com/klchoi/hyper-reader
LABEL org.opencontainers.image.description="A reader for long novels kept as .txt files"
ENV NODE_ENV=production
WORKDIR /app
# (package.json says the code is made of modules)
COPY package.json ./
COPY server ./server
# the code of src/ the server runs (the parser, what a book is, the catalog): all of it, the few
# KB of the page's own beside it, so a file it comes to need is never left out
COPY src/*.ts ./src/
COPY --from=page /app/dist/index.html ./dist/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/hello').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "server/server.ts", "--host=0.0.0.0", "--data=/data"]
CMD ["--library=books=/books"]
