# The standalone Node as a Linux container (docs/local-development/remote-node.md § The image).
#
# The build context is the folder `pnpm pack:node` writes, so the image installs exactly the tarball an
# operator would:
#
#   pnpm pack:node
#   docker build -f apps/node/Dockerfile -t acorn-node apps/node/release
#
# Agent credentials never go in the image. Pass them to `docker run` as environment variables.

# The desktop's pinned runtime (node-runtime.json), so the container runs the Node version the tests use.
FROM node:24.21.0-bookworm-slim AS build
# node-pty has no Linux prebuild, so `npm ci` compiles it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# ADD unpacks a local tarball, which holds one acorn-node folder.
ADD acorn-node-*.tar.gz /opt/
WORKDIR /opt/acorn-node
RUN npm ci --omit=dev --no-audit --no-fund && node scripts/prune-runtime.mjs

FROM node:24.21.0-bookworm-slim
# The tools a task runs: Git for projects and worktrees, tmux for terminals, ripgrep for search.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client ripgrep tmux \
  && rm -rf /var/lib/apt/lists/*
# The agent CLIs the managed agents drive. The Node never downloads them itself.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code @openai/codex && npm cache clean --force
RUN useradd --create-home --shell /bin/bash acorn && install -d -m 0700 -o acorn /data
COPY --from=build /opt/acorn-node /opt/acorn-node
# The Host check compares the port, so publish it at the same number: -p 4317:4317. Docker sets no
# SHELL, which a login would, and terminals and the login PATH probe start it.
ENV ACORN_DATA_DIR=/data ACORN_PORT=4317 SHELL=/bin/bash
VOLUME /data
USER acorn
WORKDIR /home/acorn
EXPOSE 4317
# Node is PID 1 and handles SIGTERM itself, so `docker stop` runs its drain.
CMD ["node", "--disable-warning=ExperimentalWarning", "/opt/acorn-node/dist/standalone.js"]
