# The relay as a Linux container (docs/relay.md § Run your own relay). The build context is the
# repository root, because the relay imports @acorn/protocol from the workspace:
#
#   docker build -f apps/relay/Dockerfile -t acorn-relay .
#   docker run -p 8443:8443 -e ACORN_RELAY_CREDENTIAL=$(openssl rand -hex 32) acorn-relay
#
# It serves ws://. On a public network, put a proxy that terminates TLS in front of it, or mount a
# certificate and set ACORN_RELAY_TLS_CERT and ACORN_RELAY_TLS_KEY.

# The desktop's pinned runtime (node-runtime.json), so the container runs the Node version the tests use.
FROM node:24.21.0-bookworm-slim
RUN npm install -g --no-audit --no-fund pnpm@11.0.0 && npm cache clean --force
WORKDIR /opt/acorn
COPY . .
# Only the relay and what it imports, without dev dependencies. tsx runs the TypeScript as it is.
RUN pnpm install --frozen-lockfile --prod --filter @acorn/relay... && pnpm store prune
USER node
WORKDIR /opt/acorn/apps/relay
EXPOSE 8443
CMD ["node", "--import", "tsx", "src/main.ts"]
