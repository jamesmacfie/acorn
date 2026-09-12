// What an agent CLI legitimately needs from the node's environment beyond the broker's base allowlist
// (../core/proc.ts § brokerEnv).
//
// In core rather than in the agents plugin, because core spawns an agent CLI itself now: a one-shot
// text generate through a harness backend builds its child environment from this list
// (../modelProviders/harnessRuntime.ts), and core may not import a plugin. The agents plugin's
// drivers read it back through @acorn/plugin-api/node, which is the only door they have.
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
