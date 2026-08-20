// What an agent CLI legitimately needs from the node's environment beyond the broker's base allowlist
// (@acorn/node-core/main/core/proc.ts § brokerEnv).
//
// Configuration only, never credentials, which is proc.ts's contract and the reason `ANTHROPIC_*` and
// `OPENAI_*` are absent: those globs would carry API keys, and an agent CLI authenticates through its
// own stored login under XDG_CONFIG_HOME. The proxy and TLS entries are here because an allowlist that
// omits them silently breaks every agent behind a corporate proxy.
export const AGENT_TOOL_PASSTHROUGH = [
  'XDG_CONFIG_HOME',
  'npm_config_prefix',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const
